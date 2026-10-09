"""Twilio SMS test.  python send_test_sms_twilio.py +15551234567 "Hi from Deal n Drive" """

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from twilio.base.exceptions import TwilioRestException
from twilio.rest import Client

load_dotenv(Path(__file__).parent / ".env")


def main(to_number, body):
    missing = [k for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER") if not os.environ.get(k)]
    if missing:
        sys.exit(f"Missing in .env: {', '.join(missing)}")
    client = Client(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])
    try:
        msg = client.messages.create(to=to_number, from_=os.environ["TWILIO_FROM_NUMBER"], body=body)
    except TwilioRestException as e:
        sys.exit(f"Twilio error {e.code}: {e.msg}")
    print(f"Queued - SID: {msg.sid}, status: {msg.status}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "Hi from Deal n Drive")
