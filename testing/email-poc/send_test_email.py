import os
import smtplib
import sys
from email.message import EmailMessage
from pathlib import Path

from dotenv import load_dotenv


def main(to_addr):
    load_dotenv(Path(__file__).parent / ".env")
    host = os.environ["SMTP_HOST"]
    port = int(os.environ["SMTP_PORT"])
    user = os.environ["SMTP_USER"]
    password = os.environ["SMTP_PASSWORD"]

    msg = EmailMessage()
    msg["Subject"] = "Hi from Deal n Drive"
    msg["From"] = user
    msg["To"] = to_addr
    msg.set_content("Hi,\n\nThis is a test email from the Deal n Drive email sender.\n")

    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.starttls()
        smtp.login(user, password)
        smtp.send_message(msg)
    print(f"Sent to {to_addr} from {user}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "kishoretocs@gmail.com")
