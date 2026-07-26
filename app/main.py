from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import analytics, auth, business_records, health, imports, master_data, meta, operations, planning_records, production, transport
from app.core.config import Settings, get_settings
from app.schemas.common import ErrorItem, response_envelope


def _error_response(request: Request, status_code: int, code: str, message: str, errors: list[ErrorItem] | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(
            response_envelope(
                None,
                status="REJECTED" if status_code < 500 else "FAILED",
                code=code,
                trace_id=request.state.trace_id,
                errors=errors,
            )
        ),
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="B01 网页后端", version="0.1.0", docs_url="/docs", redoc_url="/redoc")
    app.dependency_overrides[get_settings] = lambda: settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def trace_middleware(request: Request, call_next):
        trace_id = request.headers.get("X-Trace-Id") or f"TRACE-{uuid4().hex[:12].upper()}"
        request.state.trace_id = trace_id
        response = await call_next(request)
        response.headers["X-Trace-Id"] = trace_id
        return response

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "HTTP_ERROR", "message": str(exc.detail)}
        return _error_response(request, exc.status_code, detail.get("code", "HTTP_ERROR"), detail.get("message", "请求失败"))

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        errors = [
            ErrorItem(field_key=".".join(str(item) for item in error["loc"] if item != "body"), error_code="VALIDATION_ERROR", message=error["msg"])
            for error in exc.errors()
        ]
        return _error_response(request, 400, "VALIDATION_ERROR", "请求参数校验失败", errors)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, _: Exception):
        return _error_response(request, 500, "INTERNAL_ERROR", "服务器内部错误")

    app.include_router(health.router)
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(meta.router, prefix="/api/v1")
    app.include_router(master_data.router, prefix="/api/v1")
    app.include_router(production.router, prefix="/api/v1")
    app.include_router(business_records.router, prefix="/api/v1")
    app.include_router(transport.router, prefix="/api/v1")
    app.include_router(planning_records.router, prefix="/api/v1")
    app.include_router(imports.router, prefix="/api/v1")
    app.include_router(analytics.router, prefix="/api/v1")
    app.include_router(operations.router, prefix="/api/v1")
    app.include_router(analytics.public_router, prefix="/api/v1")
    return app


app = create_app()
