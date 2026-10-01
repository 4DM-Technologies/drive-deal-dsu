import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select, text

from src.auth.security import hash_password
from src.database import SessionFactory, create_schema
from src.repositories.schema import (
    Brand,
    BuyerPreference,
    BuyerRequest,
    Car,
    ConversationHistory,
    DealChat,
    DealDocument,
    DealQuote,
    ErrorLog,
    LlmAudit,
    Profile,
    State,
    SupportTicket,
    SupportVerification,
    User,
)

STATE_ROWS = [
    ("Alabama","AL"),("Alaska","AK"),("Arizona","AZ"),("Arkansas","AR"),("California","CA"),
    ("Colorado","CO"),("Connecticut","CT"),("Delaware","DE"),("District of Columbia","DC"),("Florida","FL"),
    ("Georgia","GA"),("Hawaii","HI"),("Idaho","ID"),("Illinois","IL"),("Indiana","IN"),("Iowa","IA"),
    ("Kansas","KS"),("Kentucky","KY"),("Louisiana","LA"),("Maine","ME"),("Maryland","MD"),
    ("Massachusetts","MA"),("Michigan","MI"),("Minnesota","MN"),("Mississippi","MS"),("Missouri","MO"),
    ("Montana","MT"),("Nebraska","NE"),("Nevada","NV"),("New Hampshire","NH"),("New Jersey","NJ"),
    ("New Mexico","NM"),("New York","NY"),("North Carolina","NC"),("North Dakota","ND"),("Ohio","OH"),
    ("Oklahoma","OK"),("Oregon","OR"),("Pennsylvania","PA"),("Rhode Island","RI"),("South Carolina","SC"),
    ("South Dakota","SD"),("Tennessee","TN"),("Texas","TX"),("Utah","UT"),("Vermont","VT"),
    ("Virginia","VA"),("Washington","WA"),("West Virginia","WV"),("Wisconsin","WI"),("Wyoming","WY"),
]

IDS = {
    "tx": "00000000-0000-4000-8000-000000000044", "buyer": "10000000-0000-4000-8000-000000000001",
    "adithyaa": "10000000-0000-4000-8000-000000000002", "dealer": "20000000-0000-4000-8000-000000000001",
    "dealer2": "20000000-0000-4000-8000-000000000002", "dealer3": "20000000-0000-4000-8000-000000000003",
    "support": "30000000-0000-4000-8000-000000000001", "support_admin": "30000000-0000-4000-8000-000000000002",
    "admin": "40000000-0000-4000-8000-000000000001",
    "ford": "50000000-0000-4000-8000-000000000001", "honda": "50000000-0000-4000-8000-000000000002",
    "bmw": "50000000-0000-4000-8000-000000000003",
    "bronco": "0b77057f-ed69-44bd-910d-34bf19f42e3e", "jazz": "15cd4afa-fcf7-4fc0-9af6-ca56d49f5fbb",
    "bmw_req": "2d2db297-0598-480b-87d8-f2b0a811fe57", "mustang": "15348fd2-764e-4e06-a5ec-6ffa6a08ecc5",
    "q1": "118bd33a-9443-4951-a038-a3ab811284e4", "q2": "2fa7ac94-8871-4909-8175-438a4ca16c41",
}


async def ensure_support_admin_role(session) -> None:
    """Keep existing PostgreSQL databases compatible with the support-admin role."""
    if session.get_bind().dialect.name != "postgresql":
        return
    await session.execute(text("ALTER TABLE profiles DROP CONSTRAINT IF EXISTS ck_profiles_role"))
    await session.execute(text("ALTER TABLE profiles ADD CONSTRAINT ck_profiles_role CHECK (role IN ('buyer','dealer','support','support-admin','admin'))"))
    await session.commit()


async def expand_demo_data(session, now: datetime) -> dict[str, int]:
    """Idempotently make every product surface feel populated without replacing user data."""
    texas = await session.scalar(select(State).where(State.code == "TX"))
    brand_rows = list((await session.scalars(select(Brand).order_by(Brand.name))).all())
    if texas is None or not brand_rows:
        return {}

    support_admin = await session.scalar(select(Profile).where(Profile.email == "priya@drivedeal.demo"))
    if support_admin is None:
        support_admin = Profile(id=IDS["support_admin"], state_id=texas.id, full_name="Priya Shah", email="priya@drivedeal.demo", role="support-admin", phone="+12145550155", address="Dallas, TX", terms_accepted=True, terms_version="2026-09-30", terms_accepted_at=now)
        session.add(support_admin)
        await session.flush()
        session.add(User(profile_id=support_admin.id, password_hash=hash_password("demo1234"), is_active=True))
    elif support_admin.role != "support-admin":
        support_admin.role = "support-admin"
    if not support_admin.phone:
        support_admin.phone = "+12145550155"
    if not support_admin.address:
        support_admin.address = "Dallas, TX"
    if not support_admin.state_id:
        support_admin.state_id = texas.id
    profiles = list((await session.scalars(select(Profile).order_by(Profile.created_at))).all())
    buyers = [profile for profile in profiles if profile.role == "buyer"]
    dealers = [profile for profile in profiles if profile.role == "dealer"]
    password = hash_password("demo1234")
    buyer_names = ["Aisha Patel", "Marcus Johnson", "Sofia Garcia", "Ethan Brooks", "Priya Menon", "Daniel Kim", "Olivia Reed", "Noah Williams"]
    dealer_names = ["Metro Honda", "Park Place Auto", "Northline Toyota", "EV Gallery", "Crestview Motors", "Red River Cars", "Summit Automotive", "Greenway Motors"]
    while len(buyers) < 10:
        index = len(buyers)
        profile = Profile(state_id=texas.id, full_name=buyer_names[index % len(buyer_names)], email=f"buyer{index + 1}@drivedeal.demo", role="buyer", phone=f"+14695550{200 + index}", address=["Plano, TX", "Frisco, TX", "Dallas, TX", "Irving, TX"][index % 4], terms_accepted=True, terms_version="2026-09-30", terms_accepted_at=now)
        session.add(profile)
        await session.flush()
        session.add(User(profile_id=profile.id, password_hash=password, is_active=True))
        buyers.append(profile)
    while len(dealers) < 10:
        index = len(dealers)
        profile = Profile(state_id=texas.id, full_name=f"{dealer_names[index % len(dealer_names)]} Team", email=f"dealer{index + 1}@drivedeal.demo", role="dealer", phone=f"+19725550{300 + index}", dealership_name=dealer_names[index % len(dealer_names)], branch_name=["Plano", "Dallas", "Irving", "McKinney"][index % 4], dealer_license=f"TX-DLR-{90000 + index}", website=f"https://dealer{index + 1}.example", supported_brands=[brand_rows[index % len(brand_rows)].id], terms_accepted=True, terms_version="2026-09-30", terms_accepted_at=now)
        session.add(profile)
        await session.flush()
        session.add(User(profile_id=profile.id, password_hash=password, is_active=True))
        dealers.append(profile)
    await session.flush()

    requests = list((await session.scalars(select(BuyerRequest).order_by(BuyerRequest.created_at))).all())
    models = ["Camry", "RAV4", "Civic", "CR-V", "Model Y", "Q5", "X3", "Telluride", "Tucson", "E-Class", "Tahoe", "Rogue", "F-150", "Accord", "Model 3", "GLC"]
    while len(requests) < 36:
        index = len(requests)
        buyer = buyers[index % len(buyers)]
        brand = brand_rows[index % len(brand_rows)]
        request = BuyerRequest(buyer_id=buyer.id, brand_id=brand.id, buyer_area_state_id=texas.id, model=models[index % len(models)], body_type=["SUV", "Sedan", "Hatchback", "Truck"][index % 4], fuel_type=["Gasoline", "Hybrid", "Electric", None][index % 4], year_min=2023 + index % 3, year_max=2026, trim=None, drivetrain=["AWD", "FWD", "4WD", None][index % 4], transmission="Automatic", color=None, budget_min=None, budget_max=None, target_otd_price=None, buyer_area=["Frisco, TX", "Plano, TX", "Dallas, TX", "Irving, TX", "McKinney, TX"][index % 5], search_radius_miles=[25, 50, 75, 100][index % 4], timeline=["ASAP", "Within 1 week", "Within 2 weeks", "Just exploring"][index % 4], must_haves=[["Adaptive cruise", "Rear camera"], ["AWD", "Heated seats"], ["Third-row seating"], ["Apple CarPlay"]][index % 4], additional_information="Open to dealer recommendations that match the requested specification.", request_expire=now + timedelta(days=7 + index % 21), status="open" if index % 7 else "draft")
        session.add(request)
        await session.flush()
        requests.append(request)

    quotes = list((await session.scalars(select(DealQuote).order_by(DealQuote.created_at))).all())
    existing_pairs = {(quote.buyer_request_id, quote.dealer_id) for quote in quotes}
    quote_cursor = 0
    while len(quotes) < 72 and quote_cursor < 1000:
        request = requests[quote_cursor % len(requests)]
        dealer = dealers[(quote_cursor // len(requests)) % len(dealers)]
        quote_cursor += 1
        if request.status == "draft" or (request.id, dealer.id) in existing_pairs:
            continue
        base = Decimal(26000 + (quote_cursor % 22) * 2100)
        quote = DealQuote(buyer_request_id=request.id, buyer_id=request.buyer_id, dealer_id=dealer.id, vehicle_price=base, doc_fee=Decimal(399 + quote_cursor % 5 * 75), sales_tax=(base * Decimal("0.0625")).quantize(Decimal("0.01")), title_reg=Decimal("225"), trade_in_credit=Decimal("0"), message="Transparent itemized offer with availability confirmed for this buying request.", status="pending", expires_at=now + timedelta(days=2 + quote_cursor % 6), chat_request_status="pending" if quote_cursor % 11 == 0 else "none", chat_request_message="I would like to discuss the final price and delivery timing." if quote_cursor % 11 == 0 else None)
        session.add(quote)
        await session.flush()
        quotes.append(quote)
        existing_pairs.add((request.id, dealer.id))

    chats = list((await session.scalars(select(DealChat))).all())
    open_quotes = [quote for quote in quotes if quote.status in {"accepted", "negotiating"} or quote.chat_request_status == "accepted"]
    while len(chats) < 42 and open_quotes:
        index = len(chats)
        quote = open_quotes[index % len(open_quotes)]
        sender_id = quote.buyer_id if index % 2 == 0 else quote.dealer_id
        session.add(DealChat(quote_id=quote.id, sender_id=sender_id, client_message_id=f"seed-message-{index}", message=["Could you confirm the exact trim and included equipment?", "Yes. I have attached the itemized details and can confirm delivery this week.", "Thanks—please keep me updated on the next step."][index % 3], read_at=now - timedelta(minutes=index * 3) if index % 4 else None))
        chats.append(None)

    documents = list((await session.scalars(select(DealDocument))).all())
    document_quotes = open_quotes or quotes[:1]
    while len(documents) < 18 and document_quotes:
        index = len(documents)
        quote = document_quotes[index % len(document_quotes)]
        document = DealDocument(quote_id=quote.id, dealer_id=quote.dealer_id, document_type=["window_sticker", "buyer_order", "invoice", "delivery_receipt"][index % 4], document_path=f"deals/{quote.id}/demo-document-{index + 1}.pdf", status=["pending", "confirmed", "confirmed"][index % 3])
        session.add(document)
        documents.append(document)

    preference_ids = set((await session.scalars(select(BuyerPreference.profile_id))).all())
    for index, buyer in enumerate(buyers):
        if buyer.id not in preference_ids:
            session.add(BuyerPreference(profile_id=buyer.id, brand_id=brand_rows[index % len(brand_rows)].id, other_brand_ids=[brand_rows[(index + 1) % len(brand_rows)].id], body_type=["SUV", "Sedan", "Hatchback"][index % 3], transmission="Automatic", budget_min=None, budget_max=None, must_have_features=[["Adaptive cruise"], ["Third-row seating"], ["Low mileage"]][index % 3], source="advisor", confidence=Decimal("0.780")))

    history_count = await session.scalar(select(func.count()).select_from(ConversationHistory)) or 0
    for index in range(history_count, 28):
        buyer = buyers[index % len(buyers)]
        session.add(ConversationHistory(thread_id=f"demo-thread-{index}", checkpoint_id=f"checkpoint-{index}", user_id=buyer.id, thread_type="compare" if index % 4 == 0 else "sera", checkpoint={"user": "Help me understand my best options", "assistant": "Here is a structured comparison based on reported data.", "requirements": {}}, metadata_json={"title": ["SUV shortlist", "Offer comparison", "Buying request draft", "Ownership questions"][index % 4]}))

    ticket_count = await session.scalar(select(func.count()).select_from(SupportTicket)) or 0
    for index in range(ticket_count, 24):
        caller = buyers[index % len(buyers)] if index % 3 else dealers[index % len(dealers)]
        category = "customer" if caller.role == "buyer" else "dealer"
        session.add(SupportTicket(ticket_id=f"{'TIC' if category == 'customer' else 'DS'}-{410000 + index}", category=category, caller_id=caller.id, issue_summary=["Quote notification arrived late", "Need help understanding an itemized fee", "Unable to replace a deal document", "Account profile needs correction", "Chat message did not appear immediately"][index % 5], status=["open", "in_progress", "resolved", "closed"][index % 4], priority=["low", "medium", "high", "urgent"][index % 4], notes=[{"at": (now - timedelta(hours=index)).isoformat(), "author": "Demo support", "body": "Initial triage completed."}], rca="Resolved after reviewing the affected workflow." if index % 4 == 2 else None))

    verification_profiles = dealers
    existing_verification_profiles = set((await session.scalars(select(SupportVerification.profile_id))).all())
    for index, dealer in enumerate(verification_profiles):
        if dealer.id not in existing_verification_profiles:
            session.add(SupportVerification(ticket_id=f"DV{1789000000 + index}", category="dealer", profile_id=dealer.id, status="pending" if index % 3 else "approved", notes=[{"reason": "Seeded business verification evidence."}], email_sent=index % 3 == 0, decided_by=IDS["support"] if index % 3 == 0 else None, decided_at=now - timedelta(days=index) if index % 3 == 0 else None))

    audit_count = await session.scalar(select(func.count()).select_from(LlmAudit)) or 0
    for index in range(audit_count, 36):
        session.add(LlmAudit(task_type=["classifier", "kb_search", "web_search", "advisor", "compare"][index % 5], provider="openai", model_name="gpt-5.6-sol", thread_id=f"demo-thread-{index % 28}", input_tokens=240 + index * 7, output_tokens=110 + index * 3, total_tokens=350 + index * 10, latency_ms=620 + index * 31, status="error" if index % 13 == 0 else "success"))
    error_count = await session.scalar(select(func.count()).select_from(ErrorLog)) or 0
    for index in range(error_count, 16):
        session.add(ErrorLog(level="warning" if index % 4 else "error", error_code=["RATE_LIMITED", "STALE_QUOTE", "AI_FALLBACK", "UPLOAD_RETRY"][index % 4], error_message="Seeded operational event for support and observability demos.", source=["api", "marketplace", "ai_service", "storage"][index % 4], endpoint=["/quotes", "/requests", "/ai/chat", "/documents"][index % 4], user_id=buyers[index % len(buyers)].id, thread_id=f"demo-thread-{index % 28}", error_context={"seed": True, "occurrence": index}))
    await session.flush()
    return {table.__tablename__: int(await session.scalar(select(func.count()).select_from(table)) or 0) for table in [Profile, BuyerRequest, DealQuote, DealChat, DealDocument, BuyerPreference, ConversationHistory, SupportTicket, SupportVerification, LlmAudit, ErrorLog, Car]}


async def seed_database(force: bool = False) -> None:
    await create_schema()
    async with SessionFactory() as session:
        await ensure_support_admin_role(session)
        count = await session.scalar(select(func.count()).select_from(State))
        if count and not force:
            now = datetime.now(UTC)
            car_count = await session.scalar(select(func.count()).select_from(Car)) or 0
            if car_count < 120:
                brand_rows = list((await session.scalars(select(Brand).order_by(Brand.name))).all())
                texas = await session.scalar(select(State).where(State.code == "TX"))
                dealer = await session.scalar(select(Profile).where(Profile.role == "dealer"))
                if brand_rows and texas and dealer:
                    models = ["Bronco", "Civic", "5 Series", "Q5", "Tahoe", "Tucson", "Telluride", "XUV700", "E-Class", "Rogue", "Model Y", "RAV4"]
                    for index in range(car_count, 120):
                        brand = brand_rows[index % len(brand_rows)]
                        session.add(Car(seller_id=dealer.id, brand_id=brand.id, state_id=texas.id, title=f"{2022 + index % 5} {brand.name} {models[index % len(models)]}", model=models[index % len(models)], model_year=2022 + index % 5, body_type=["SUV", "Hatchback", "Sedan", "Pickup"][index % 4], seating_capacity=5 + (2 if index % 7 == 0 else 0), condition="new" if index % 4 else "used", mileage=24 if index % 4 else 4500 + index * 137, fuel=["Gasoline", "Hybrid", "Electric"][index % 3], transmission="Automatic", price=Decimal(str(24500 + (index % 24) * 2750)), rating=Decimal(str(4.2 + (index % 8) / 10)), reviews=[{"rating": 5, "summary": "Transparent Deal&Drive inventory"}], image_paths=[f"cars/demo-{index % 12 + 1}.webp"], status="reserved" if index % 17 == 0 else "available"))
                    await session.commit()
                    print(f"Deal&Drive inventory expanded from {car_count} to 120 vehicles.")
            counts = await expand_demo_data(session, now)
            await session.commit()
            print(f"Deal&Drive demo data is current: {counts}")
            return
        now = datetime.now(UTC)
        states = []
        for index, (name, code) in enumerate(STATE_ROWS, start=1):
            state_id = IDS["tx"] if code == "TX" else f"00000000-0000-4000-8000-{index:012d}"
            rate = Decimal("0.06250") if code == "TX" else Decimal("0.07250") if code == "CA" else Decimal("0.00000")
            states.append(State(id=state_id, name=name, code=code, sales_tax_rate=rate))
        session.add_all(states)
        await session.flush()
        brand_specs = [
            ("ford","Ford","US",False),("honda","Honda","JP",False),("bmw","BMW","DE",True),
            (None,"Audi","DE",True),(None,"Chevrolet","US",False),(None,"Hyundai","KR",False),
            (None,"Kia","KR",False),(None,"Mahindra","IN",False),(None,"Mercedes-Benz","DE",True),
            (None,"Nissan","JP",False),(None,"Tesla","US",True),(None,"Toyota","JP",False),
        ]
        brands = []
        for index, (key, name, country, premium) in enumerate(brand_specs, start=1):
            brands.append(Brand(id=IDS[key] if key else f"50000000-0000-4000-8000-{index:012d}", name=name, country_code=country, is_premium=premium))
        session.add_all(brands)
        await session.flush()
        profiles = [
            Profile(id=IDS["buyer"], state_id=IDS["tx"], full_name="Rahul Sharma", email="rahul@drivedeal.demo", role="buyer", phone="+14695550142", address="Frisco, TX", terms_accepted=True, terms_version="2026-09-30", terms_accepted_at=now),
            Profile(id=IDS["adithyaa"], state_id=IDS["tx"], full_name="Adithyaa Rao", email="adithyaa@drivedeal.demo", role="buyer", phone="+12145550177", address="Plano, TX", terms_accepted=True, terms_version="2026-09-30", terms_accepted_at=now),
            Profile(id=IDS["dealer"], state_id=IDS["tx"], full_name="Naveen Kumar", email="naveen@naveemotors.demo", role="dealer", phone="+19725550120", dealership_name="Navee Motors", branch_name="Westside", dealer_license="TX-DLR-88041", website="https://naveemotors.example", supported_brands=[IDS["ford"],IDS["honda"],IDS["bmw"]], terms_accepted=True, terms_version="2026-09-30", terms_accepted_at=now),
            Profile(id=IDS["dealer2"], state_id=IDS["tx"], full_name="Elena Ruiz", email="elena@lonestar.demo", role="dealer", phone="+14695550191", dealership_name="Lone Star Ford", branch_name="McKinney", dealer_license="TX-DLR-88042", website="https://lonestar.example", supported_brands=[IDS["ford"]], terms_accepted=True, terms_version="2026-09-30", terms_accepted_at=now),
            Profile(id=IDS["dealer3"], state_id=IDS["tx"], full_name="Jordan Blake", email="jordan@northtexas.demo", role="dealer", phone="+19405550125", dealership_name="North Texas Auto", branch_name="Denton", dealer_license="TX-DLR-88043", website="https://northtexas.example", supported_brands=[IDS["ford"]], terms_accepted=True, terms_version="2026-09-30", terms_accepted_at=now),
            Profile(id=IDS["support"], state_id=IDS["tx"], full_name="Maya Lewis", email="maya@drivedeal.demo", role="support", phone="+12145550133", address="Dallas, TX", terms_accepted=True, terms_version="2026-09-30", terms_accepted_at=now),
            Profile(id=IDS["support_admin"], state_id=IDS["tx"], full_name="Priya Shah", email="priya@drivedeal.demo", role="support-admin", phone="+12145550155", address="Dallas, TX", terms_accepted=True, terms_version="2026-09-30", terms_accepted_at=now),
            Profile(id=IDS["admin"], state_id=IDS["tx"], full_name="Alex Morgan", email="alex@drivedeal.demo", role="admin", phone="+12145550144", address="Dallas, TX", terms_accepted=True, terms_version="2026-09-30", terms_accepted_at=now),
        ]
        session.add_all(profiles)
        await session.flush()
        password = hash_password("demo1234")
        session.add_all([User(profile_id=profile.id, password_hash=password, is_active=profile.id != IDS["dealer3"]) for profile in profiles])
        await session.flush()
        session.add_all([
            Car(seller_id=IDS["dealer"], brand_id=brands[index % len(brands)].id, state_id=IDS["tx"], title=f"{2022 + index % 5} {brands[index % len(brands)].name} Demo Vehicle", model=["Bronco","Jazz","5 Series","Q5","Tahoe","Tucson","Telluride","XUV700","E-Class","Rogue","Model Y","RAV4"][index % 12], model_year=2022+index%5, body_type=["SUV","Hatchback","Sedan","Pickup"][index%4], seating_capacity=5 + (2 if index % 7 == 0 else 0), condition="new" if index%4 else "used", mileage=24 if index%4 else 4500+index*137, fuel=["Gasoline","Hybrid","Electric"][index%3], transmission="Automatic", price=Decimal(str(24500+(index%24)*2750)), rating=Decimal(str(4.2+(index%8)/10)), reviews=[{"rating":5,"summary":"Clear buying experience"}], image_paths=[f"cars/demo-{index%12+1}.webp"], status="reserved" if index%17==0 else "available") for index in range(120)
        ])
        requests = [
            BuyerRequest(id=IDS["bronco"], buyer_id=IDS["buyer"], brand_id=IDS["ford"], buyer_area_state_id=IDS["tx"], model="Bronco", body_type="SUV", year_min=2024, year_max=2026, budget_min=Decimal("38000"), budget_max=Decimal("75000"), target_otd_price=Decimal("68000"), buyer_area="Frisco, TX", search_radius_miles=50, timeline="Within 2 weeks", must_haves=["4WD","Adaptive cruise","Hard top"], request_expire=now+timedelta(days=12), status="open"),
            BuyerRequest(id=IDS["jazz"], buyer_id=IDS["buyer"], brand_id=IDS["honda"], buyer_area_state_id=IDS["tx"], model="Jazz", body_type="Hatchback", year_min=2025, year_max=2026, budget_max=Decimal("30000"), target_otd_price=Decimal("28000"), buyer_area="Frisco, TX", search_radius_miles=25, timeline="Within 1 week", must_haves=["Automatic","Rear camera"], request_expire=now+timedelta(days=4), status="fulfilled"),
            BuyerRequest(id=IDS["bmw_req"], buyer_id=IDS["buyer"], brand_id=IDS["bmw"], buyer_area_state_id=IDS["tx"], model="5 Series", body_type="Sedan", year_min=2024, year_max=2026, budget_min=Decimal("60000"), budget_max=Decimal("80000"), target_otd_price=Decimal("70000"), buyer_area="Dallas, TX", search_radius_miles=50, timeline="Just exploring", must_haves=["AWD","Driver assistance"], request_expire=now+timedelta(days=20), status="open"),
            BuyerRequest(id=IDS["mustang"], buyer_id=IDS["adithyaa"], brand_id=IDS["ford"], buyer_area_state_id=IDS["tx"], model="Mustang GT", body_type="Sports Car", year_min=2023, year_max=2026, buyer_area="Plano, TX", search_radius_miles=100, timeline="Just exploring", must_haves=["V8","Manual preferred"], request_expire=now+timedelta(days=26), status="open"),
            BuyerRequest(buyer_id=IDS["buyer"], brand_id=IDS["honda"], buyer_area_state_id=IDS["tx"], model="CR-V", body_type="SUV", buyer_area="Frisco, TX", search_radius_miles=50, timeline="ASAP", request_expire=now+timedelta(days=7), status="open"),
            BuyerRequest(buyer_id=IDS["adithyaa"], brand_id=IDS["bmw"], buyer_area_state_id=IDS["tx"], model="X3", body_type="SUV", buyer_area="Plano, TX", search_radius_miles=75, timeline="Within 2 weeks", request_expire=now+timedelta(days=14), status="draft"),
        ]
        session.add_all(requests)
        await session.flush()
        quotes = [
            DealQuote(id=IDS["q1"], buyer_request_id=IDS["bronco"], buyer_id=IDS["buyer"], dealer_id=IDS["dealer"], vehicle_price=Decimal("65345"), doc_fee=Decimal("800"), sales_tax=Decimal("4084"), title_reg=Decimal("0"), trade_in_credit=Decimal("0"), message="In-stock Bronco Outer Banks with hard top.", status="pending", expires_at=now+timedelta(days=3)),
            DealQuote(buyer_request_id=IDS["bronco"], buyer_id=IDS["buyer"], dealer_id=IDS["dealer2"], vehicle_price=Decimal("65800"), doc_fee=Decimal("595"), sales_tax=Decimal("4112.50"), title_reg=Decimal("210"), trade_in_credit=Decimal("0"), message="Factory allocation available this week.", status="pending", chat_request_status="pending", chat_request_message="Can we discuss delivery timing?", expires_at=now+timedelta(days=2)),
            DealQuote(buyer_request_id=IDS["bronco"], buyer_id=IDS["buyer"], dealer_id=IDS["dealer3"], vehicle_price=Decimal("66200"), doc_fee=Decimal("695"), sales_tax=Decimal("4137.50"), title_reg=Decimal("225"), trade_in_credit=Decimal("0"), message="No mandatory accessories.", status="pending", expires_at=now+timedelta(days=4)),
            DealQuote(id=IDS["q2"], buyer_request_id=IDS["jazz"], buyer_id=IDS["buyer"], dealer_id=IDS["dealer"], vehicle_price=Decimal("32600"), doc_fee=Decimal("150"), sales_tax=Decimal("2038"), title_reg=Decimal("203"), trade_in_credit=Decimal("0"), message="White pearl Jazz with delivery included.", status="accepted", deal_status="funds_arrived", deal_history=[{"ts":(now-timedelta(days=1)).isoformat(),"actor_id":IDS["buyer"],"actor_role":"buyer","event":"quote_accepted"}], chat_request_status="accepted", expires_at=now+timedelta(days=1)),
            DealQuote(buyer_request_id=IDS["jazz"], buyer_id=IDS["buyer"], dealer_id=IDS["dealer2"], vehicle_price=Decimal("32950"), doc_fee=Decimal("499"), sales_tax=Decimal("2059.38"), title_reg=Decimal("203"), trade_in_credit=Decimal("0"), status="declined", expires_at=now+timedelta(days=1)),
            DealQuote(buyer_request_id=IDS["bmw_req"], buyer_id=IDS["buyer"], dealer_id=IDS["dealer"], vehicle_price=Decimal("68400"), doc_fee=Decimal("650"), sales_tax=Decimal("4275"), title_reg=Decimal("225"), trade_in_credit=Decimal("3500"), status="negotiating", chat_request_status="accepted", expires_at=now+timedelta(days=5)),
            DealQuote(buyer_request_id=IDS["mustang"], buyer_id=IDS["adithyaa"], dealer_id=IDS["dealer2"], vehicle_price=Decimal("54500"), doc_fee=Decimal("499"), sales_tax=Decimal("3406.25"), title_reg=Decimal("225"), trade_in_credit=Decimal("0"), status="pending", expires_at=now+timedelta(days=5)),
        ]
        session.add_all(quotes)
        await session.flush()
        session.add_all([
            DealChat(quote_id=IDS["q2"], sender_id=IDS["buyer"], message="Is delivery to Frisco included?"),
            DealChat(quote_id=IDS["q2"], sender_id=IDS["dealer"], message="Yes, delivery is included."),
            DealChat(quote_id=IDS["q2"], sender_id=IDS["buyer"], message="Perfect. Please keep me posted."),
        ])
        session.add_all([
            DealDocument(quote_id=IDS["q2"], dealer_id=IDS["dealer"], document_type="window_sticker", document_path="deals/jazz/window-sticker.pdf", status="confirmed"),
            DealDocument(quote_id=IDS["q2"], dealer_id=IDS["dealer"], document_type="buyer_order", document_path="deals/jazz/buyer-order.pdf", status="confirmed"),
        ])
        session.add(BuyerPreference(profile_id=IDS["buyer"], brand_id=IDS["ford"], other_brand_ids=[IDS["honda"],IDS["bmw"]], body_type="SUV", transmission="Automatic", budget_min=35000, budget_max=75000, must_have_features=["Adaptive cruise","Rear camera"], source="advisor", confidence=Decimal("0.860")))
        session.add_all([ConversationHistory(thread_id=f"thread-{i}", checkpoint_id="seed", user_id=IDS["buyer"], thread_type="sera" if i<4 else "compare", checkpoint={"user":"Demo question","assistant":"Seeded advisor answer","requirements":{}}, metadata_json={"title":title}) for i,title in enumerate(["Bronco quote comparison","Family SUV shortlist","BMW ownership costs","New request draft"],start=1)])
        session.add_all([
            SupportTicket(ticket_id="TIC-316519", category="customer", caller_id=IDS["buyer"], issue_summary="Requests page is slow when many quotes arrive", status="in_progress", priority="high", notes=[]),
            SupportTicket(ticket_id="DS9940692696", category="dealer", caller_id=IDS["dealer"], issue_summary="Need help replacing a deal document", status="open", priority="medium", notes=[]),
        ])
        session.add_all([
            SupportVerification(ticket_id="DV1788793917", category="dealer", profile_id=IDS["dealer3"], status="pending", notes=[]),
            SupportVerification(ticket_id="DV1788882726", category="dealer", profile_id=IDS["dealer"], status="approved", notes=[], email_sent=True, decided_by=IDS["support"], decided_at=now-timedelta(days=30)),
            SupportVerification(ticket_id="DV1788278835", category="dealer", profile_id=IDS["dealer2"], status="denied", notes=[{"reason":"Document mismatch"}], decided_by=IDS["support"], decided_at=now-timedelta(days=20)),
            SupportVerification(ticket_id="SA97379", category="agent", profile_id=IDS["support"], status="approved", notes=[], email_sent=True, decided_by=IDS["admin"], decided_at=now-timedelta(days=60)),
        ])
        session.add_all([LlmAudit(task_type=task, provider="openai", model_name="gpt-5.6-sol", thread_id=f"thread-{index}", input_tokens=320, output_tokens=180, total_tokens=500, latency_ms=780, status="success") for index,task in enumerate(["classifier","advisor","compare"],start=1)])
        session.add_all([
            ErrorLog(level="warning", error_code="PAGE_SLOW", error_message="Buyer request list exceeded target render time", source="frontend", endpoint="/requests", user_id=IDS["buyer"], error_context={"p95_ms":4200}),
            ErrorLog(level="error", error_code="AI_PROVIDER_TIMEOUT", error_message="Provider timed out and deterministic fallback was used", source="ai_service", endpoint="/ai/chat", user_id=IDS["buyer"], thread_id="thread-2", error_context={"timeout_seconds":45}),
        ])
        counts = await expand_demo_data(session, now)
        await session.commit()
        print(f"Deal&Drive database seeded with coherent cross-table demo data: {counts}")


if __name__ == "__main__":
    asyncio.run(seed_database())
