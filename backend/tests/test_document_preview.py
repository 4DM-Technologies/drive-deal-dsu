import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import delete

from main import app
from src.database import SessionFactory
from src.repositories.schema import DealDocument
from tests.demo_data import IDS

BUYER = "rahul@drivedeal.demo"
WORD_PATH = f"deals/{IDS['q2']}/{IDS['dealer']}/0000--Quotation.docx"


def login(client: TestClient, email: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def word_document(present: bool) -> None:
    async def _apply() -> None:
        async with SessionFactory() as session:
            await session.execute(delete(DealDocument).where(DealDocument.document_path == WORD_PATH))
            if present:
                session.add(
                    DealDocument(
                        quote_id=IDS["q2"],
                        dealer_id=IDS["dealer"],
                        document_type="quote_document",
                        document_path=WORD_PATH,
                        status="confirmed",
                    )
                )
            await session.commit()

    asyncio.run(_apply())


def test_pdf_gets_an_inline_preview_link_and_word_files_do_not() -> None:
    word_document(present=True)
    try:
        with TestClient(app) as client:
            rows = client.get(f"/api/v1/documents/{IDS['q2']}", headers=login(client, BUYER)).json()
    finally:
        word_document(present=False)

    pdf = next(row for row in rows if row["file_name"] == "window-sticker.pdf")
    # The download link still saves the file; the preview link opens it in place.
    assert "download=true" in pdf["download_url"]
    assert pdf["preview_url"] and "download=true" not in pdf["preview_url"]
    word = next(row for row in rows if row["file_name"] == "Quotation.docx")
    assert word["preview_url"] is None and "download=true" in word["download_url"]
