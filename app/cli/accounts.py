from __future__ import annotations

import argparse
import getpass
import sys
from collections.abc import Sequence
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.user import User

ROLES = ("park_admin", "enterprise_admin")
MIN_PASSWORD_LENGTH = 12


class AccountError(ValueError):
    pass


def normalize_required(value: str, label: str, max_length: int) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise AccountError(f"{label}不能为空")
    if len(cleaned) > max_length:
        raise AccountError(f"{label}不能超过 {max_length} 个字符")
    return cleaned


def normalize_username(username: str) -> str:
    cleaned = normalize_required(username, "用户名", 128)
    if len(cleaned) < 3 or any(character.isspace() for character in cleaned):
        raise AccountError("用户名需为 3～128 个非空白字符")
    return cleaned


def normalize_enterprise_ids(values: Sequence[str] | None) -> list[str]:
    result: list[str] = []
    for value in values or []:
        enterprise_id = normalize_required(value, "企业 ID", 64)
        if enterprise_id not in result:
            result.append(enterprise_id)
    return result


def validate_password(password: str, username: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise AccountError(f"密码至少需要 {MIN_PASSWORD_LENGTH} 位")
    if len(password) > 256:
        raise AccountError("密码不能超过 256 位")
    if password.casefold() == username.casefold():
        raise AccountError("密码不能与用户名相同")


def require_user(db: Session, username: str) -> User:
    cleaned = normalize_username(username)
    user = db.scalar(select(User).where(User.username == cleaned))
    if user is None:
        raise AccountError(f"账号 {cleaned} 不存在")
    return user


def invalidate_sessions(user: User) -> None:
    user.session_version += 1
    user.last_activity_at = None


def create_account(
    db: Session,
    *,
    username: str,
    password: str,
    role: str,
    park_id: str,
    enterprise_ids: Sequence[str] | None = None,
) -> User:
    cleaned_username = normalize_username(username)
    cleaned_park_id = normalize_required(park_id, "园区 ID", 64)
    cleaned_enterprise_ids = normalize_enterprise_ids(enterprise_ids)
    if role not in ROLES:
        raise AccountError("角色必须是 park_admin 或 enterprise_admin")
    if role == "enterprise_admin" and not cleaned_enterprise_ids:
        raise AccountError("企业管理员至少需要一个 --enterprise-id")
    validate_password(password, cleaned_username)
    if db.scalar(select(User).where(User.username == cleaned_username)) is not None:
        raise AccountError(f"账号 {cleaned_username} 已存在")
    user = User(
        user_id=f"USER-{uuid4().hex.upper()}",
        username=cleaned_username,
        password_hash=hash_password(password),
        role=role,
        park_id=cleaned_park_id,
        enterprise_ids=cleaned_enterprise_ids,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def list_accounts(db: Session) -> list[User]:
    return list(db.scalars(select(User).order_by(User.username)).all())


def reset_account_password(db: Session, username: str, password: str) -> User:
    user = require_user(db, username)
    validate_password(password, user.username)
    user.password_hash = hash_password(password)
    invalidate_sessions(user)
    db.commit()
    return user


def set_account_active(db: Session, username: str, is_active: bool) -> User:
    user = require_user(db, username)
    if user.is_active != is_active:
        user.is_active = is_active
        invalidate_sessions(user)
        db.commit()
    return user


def set_account_scope(
    db: Session,
    username: str,
    *,
    role: str,
    park_id: str,
    enterprise_ids: Sequence[str] | None = None,
) -> User:
    user = require_user(db, username)
    cleaned_park_id = normalize_required(park_id, "园区 ID", 64)
    cleaned_enterprise_ids = normalize_enterprise_ids(enterprise_ids)
    if role not in ROLES:
        raise AccountError("角色必须是 park_admin 或 enterprise_admin")
    if role == "enterprise_admin" and not cleaned_enterprise_ids:
        raise AccountError("企业管理员至少需要一个 --enterprise-id")
    user.role = role
    user.park_id = cleaned_park_id
    user.enterprise_ids = cleaned_enterprise_ids
    invalidate_sessions(user)
    db.commit()
    return user


def prompt_password(username: str) -> str:
    password = getpass.getpass(f"为 {username} 输入新密码（至少 {MIN_PASSWORD_LENGTH} 位）：")
    confirmation = getpass.getpass("再次输入密码：")
    if password != confirmation:
        raise AccountError("两次输入的密码不一致")
    return password


def add_scope_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--role", choices=ROLES, required=True)
    parser.add_argument("--park-id", required=True)
    parser.add_argument("--enterprise-id", action="append", default=[])


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="E01 本机账户维护工具（密码始终隐藏输入）")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="列出账号，不显示密码或哈希")

    create = commands.add_parser("create", help="创建管理员账号")
    create.add_argument("--username", required=True)
    add_scope_arguments(create)

    reset = commands.add_parser("reset-password", help="重置密码并注销既有会话")
    reset.add_argument("username")

    for command, help_text in (("activate", "启用账号"), ("deactivate", "停用账号")):
        action = commands.add_parser(command, help=help_text)
        action.add_argument("username")

    scope = commands.add_parser("set-scope", help="替换角色、园区和企业范围")
    scope.add_argument("username")
    add_scope_arguments(scope)
    return parser


def print_accounts(users: Sequence[User]) -> None:
    if not users:
        print("当前没有 E01 账号。")
        return
    print("用户名\t角色\t状态\t园区\t企业范围\t最后登录")
    for user in users:
        enterprises = ",".join(user.enterprise_ids or []) or "-"
        last_login = user.last_login_at.isoformat(timespec="seconds") if user.last_login_at else "-"
        print(f"{user.username}\t{user.role}\t{'启用' if user.is_active else '停用'}\t{user.park_id}\t{enterprises}\t{last_login}")


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        from app.db.session import SessionLocal

        with SessionLocal() as db:
            if args.command == "list":
                print_accounts(list_accounts(db))
                return 0
            if args.command == "create":
                user = create_account(
                    db,
                    username=args.username,
                    password=prompt_password(args.username),
                    role=args.role,
                    park_id=args.park_id,
                    enterprise_ids=args.enterprise_id,
                )
            elif args.command == "reset-password":
                user = reset_account_password(db, args.username, prompt_password(args.username))
            elif args.command == "activate":
                user = set_account_active(db, args.username, True)
            elif args.command == "deactivate":
                user = set_account_active(db, args.username, False)
            else:
                user = set_account_scope(
                    db,
                    args.username,
                    role=args.role,
                    park_id=args.park_id,
                    enterprise_ids=args.enterprise_id,
                )
        print(f"账户操作完成：{user.username} · {user.role} · {'启用' if user.is_active else '停用'}")
        return 0
    except AccountError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
