"""AWS End User Messaging SMS test tool.

  python send_test_sms_aws.py status
  python send_test_sms_aws.py verify-add +15551234567
  python send_test_sms_aws.py verify-confirm +15551234567 123456
  python send_test_sms_aws.py send +15551234567 "Hi from Deal n Drive" [--dry-run]
"""

import os
import sys
from pathlib import Path

import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")
sms = boto3.client("pinpoint-sms-voice-v2", region_name=os.environ.get("AWS_REGION", "us-east-1"))


def status():
    for attr in sms.describe_account_attributes()["AccountAttributes"]:
        print(f"{attr['Name']}: {attr['Value']}")
    for limit in sms.describe_spend_limits()["SpendLimits"]:
        if limit["Name"] == "TEXT_MESSAGE_MONTHLY_SPEND_LIMIT":
            print(f"SMS monthly spend limit: ${limit['EnforcedLimit']}")
    print("\nOrigination numbers:")
    for n in sms.describe_phone_numbers()["PhoneNumbers"]:
        print(f"  {n['PhoneNumber']}  {n['NumberType']}  status={n['Status']}")
    print("\nVerified destination numbers:")
    for d in sms.describe_verified_destination_numbers()["VerifiedDestinationNumbers"]:
        print(f"  {d['DestinationPhoneNumber']}  status={d['Status']}")


def verify_add(phone):
    vid = sms.create_verified_destination_number(DestinationPhoneNumber=phone)["VerifiedDestinationNumberId"]
    sms.send_destination_number_verification_code(VerifiedDestinationNumberId=vid, VerificationChannel="TEXT")
    print(f"Verification code texted to {phone}")


def verify_confirm(phone, code):
    found = sms.describe_verified_destination_numbers(DestinationPhoneNumbers=[phone])["VerifiedDestinationNumbers"]
    if not found:
        sys.exit(f"{phone} not added yet - run verify-add first")
    sms.verify_destination_number(VerifiedDestinationNumberId=found[0]["VerifiedDestinationNumberId"], VerificationCode=code)
    print(f"{phone} verified")


def send(phone, body, dry_run):
    origin = os.environ.get("SMS_ORIGINATION_NUMBER")
    if not origin:
        sys.exit("Set SMS_ORIGINATION_NUMBER in .env (your AWS toll-free or 10DLC number)")
    resp = sms.send_text_message(
        DestinationPhoneNumber=phone,
        OriginationIdentity=origin,
        MessageBody=body,
        MessageType="TRANSACTIONAL",
        DryRun=dry_run,
    )
    print(f"{'Dry run OK' if dry_run else 'Sent'} - MessageId: {resp.get('MessageId')}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    cmd = args[0] if args else "status"
    try:
        if cmd == "status":
            status()
        elif cmd == "verify-add":
            verify_add(args[1])
        elif cmd == "verify-confirm":
            verify_confirm(args[1], args[2])
        elif cmd == "send":
            send(args[1], args[2] if len(args) > 2 else "Hi from Deal n Drive", "--dry-run" in sys.argv)
        else:
            sys.exit(__doc__)
    except NoCredentialsError:
        sys.exit("No AWS credentials - set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in testing/sms-poc/.env")
    except ClientError as e:
        sys.exit(f"AWS error: {e.response['Error']['Code']}: {e.response['Error']['Message']}")
