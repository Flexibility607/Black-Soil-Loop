import pytest

from app.cli.accounts import (
    AccountError,
    create_account,
    list_accounts,
    reset_account_password,
    set_account_active,
    set_account_scope,
)
from app.core.security import verify_password

PASSWORD = "correct horse battery 2026"


def test_create_and_list_account(db_session) -> None:
    user = create_account(
        db_session,
        username="park_operator",
        password=PASSWORD,
        role="park_admin",
        park_id="PARK-001",
    )

    assert user.username == "park_operator"
    assert user.session_version == 0
    assert verify_password(PASSWORD, user.password_hash)
    assert [item.username for item in list_accounts(db_session)] == ["park_operator"]
    with pytest.raises(AccountError, match="已存在"):
        create_account(
            db_session,
            username="park_operator",
            password=PASSWORD,
            role="park_admin",
            park_id="PARK-001",
        )


def test_maintenance_invalidates_sessions(db_session) -> None:
    user = create_account(
        db_session,
        username="maintainer",
        password=PASSWORD,
        role="park_admin",
        park_id="PARK-001",
    )

    reset_account_password(db_session, user.username, "new secure password 2026")
    set_account_scope(
        db_session,
        user.username,
        role="enterprise_admin",
        park_id="PARK-001",
        enterprise_ids=["ENT-001", "ENT-002"],
    )
    set_account_active(db_session, user.username, False)

    assert user.session_version == 3
    assert user.enterprise_ids == ["ENT-001", "ENT-002"]
    assert user.is_active is False
    assert verify_password("new secure password 2026", user.password_hash)


def test_enterprise_admin_requires_enterprise_scope(db_session) -> None:
    with pytest.raises(AccountError, match="至少需要一个"):
        create_account(
            db_session,
            username="enterprise_operator",
            password=PASSWORD,
            role="enterprise_admin",
            park_id="PARK-001",
        )
