import os
import sys
from pathlib import Path

import msal
import requests
from dotenv import load_dotenv

GRAPH = "https://graph.microsoft.com/v1.0"


def get_token():
    app = msal.ConfidentialClientApplication(
        os.environ["GRAPH_CLIENT_ID"],
        authority=f"https://login.microsoftonline.com/{os.environ['GRAPH_TENANT_ID']}",
        client_credential=os.environ["GRAPH_CLIENT_SECRET"],
    )
    result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    if "access_token" not in result:
        sys.exit(f"Token error: {result.get('error')}: {result.get('error_description')}")
    return result["access_token"]


def main(to_addr):
    load_dotenv(Path(__file__).parent / ".env")
    missing = [k for k in ("GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET") if not os.environ.get(k)]
    if missing:
        sys.exit(f"Missing in .env: {', '.join(missing)}")
    sender = os.environ["GRAPH_SENDER"]

    resp = requests.post(
        f"{GRAPH}/users/{sender}/sendMail",
        headers={"Authorization": f"Bearer {get_token()}"},
        json={
            "message": {
                "subject": "Hi from Deal n Drive",
                "body": {
                    "contentType": "Text",
                    "content": "Hi,\n\nThis is a test email from the Deal n Drive email sender (Microsoft Graph).\n",
                },
                "toRecipients": [{"emailAddress": {"address": to_addr}}],
            },
            "saveToSentItems": True,
        },
        timeout=30,
    )
    if resp.status_code != 202:
        sys.exit(f"Send failed ({resp.status_code}): {resp.text}")
    print(f"Sent to {to_addr} from {sender}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "kishoretocs@gmail.com")
