const MEMBERSHIP_PRICE = '$500';

export const buyerFaqs = [
  { question: 'Is Deal&Drive free for buyers?', answer: 'Yes, it is free for buyers. Posting a request, receiving quotes, comparing offers, negotiating, and working with Sera never cost you anything. Dealers pay only when a deal closes, so they are rewarded for winning your business with a competitive offer, not for chasing you.' },
  { question: 'What does “out-the-door” actually include?', answer: 'Every quote is itemized and covers the vehicle price, sales tax, title, license, and the dealer’s doc fee. That total is what you would actually pay to drive the car away, so nothing surprising gets added later. Quotes are ranked by this final number, which keeps every comparison like for like.' },
  { question: 'How anonymous am I, really?', answer: 'Dealers see the car you want, your target price, and how far you will travel. They never see your name, phone number, or email. Your details stay hidden while quotes arrive and while you negotiate in-platform, and they are shared only once you accept a quote, so you decide who hears from you.' },
  { question: 'Can I include a trade-in or financing?', answer: 'Yes. Add your trade-in details or your financing preference when you build your request, and dealers will factor them into their quote. Instead of juggling separate numbers for the car, the trade, and the loan, you get one final figure from each dealer that you can compare side by side.' },
  { question: 'What is Sera?', answer: 'Sera is our AI advisor. Describe the car you want in plain language and Sera builds your request for you, including make, model, trim, color, target price, and travel distance. Nothing is sent to dealers until you review it and give your OK, and Sera can also help you compare quotes once they come in.' },
  { question: 'Do I have to accept a quote?', answer: 'No. A quote is an offer, not a commitment. Only you can accept one, and until you do you can keep comparing, ask questions in the in-platform chat, or decline offers you don’t like. Accepting is the final step, so take your time.' },
  { question: 'Can I negotiate the price?', answer: 'Yes. Open a chat on any quote and negotiate with the dealer in the platform. Dealers can revise their itemized quote, and your ranking updates as they do, so you always see the best total first.' },
  { question: 'Are the dealers verified?', answer: 'Yes. Every dealer applies with their dealership details and licence number, and our support team reviews each application. Dealers can’t see a single request or send a quote until they’re approved.' },
];

export const dealerFaqs = [
  { question: 'What does it cost to be on Deal&Drive?', answer: `Start free: your first 2 months include up to 3 quotes. After that, a dealer membership is ${MEMBERSHIP_PRICE} a year for unlimited quotes, and each renewal adds another year.` },
  { question: 'How are requests matched to my dealership?', answer: 'Buyers choose a search radius, and you’re notified about requests inside it. Your feed is built around the brands you carry, and you can filter by brand, body type, budget, distance, and timeframe to focus on the cars you can deliver.' },
  { question: 'What does the buyer see in my quote?', answer: 'An itemized out-the-door breakdown: vehicle price, documentation fee, sales tax, title and registration, and any trade-in credit, rolled into one final total. Quotes are ranked by that number, so every comparison is like for like.' },
  { question: 'When do I get the buyer’s contact details?', answer: 'Buyers stay anonymous while quotes arrive and while you negotiate in-platform. When a buyer accepts your quote, you receive their full contact details so you can finalize the deal in person.' },
  { question: 'Can I change or pull a quote?', answer: 'Yes. You hold one live quote per request, which you can revise as the market moves, withdraw if the car is no longer available, or set to expire on a date you choose.' },
  { question: 'How does dealer verification work?', answer: 'You apply with your dealership details, licence number, and supported brands. Our support team reviews each application, and you’ll receive an email once your account is approved. Sign-in stays locked until then, which keeps the network trustworthy for buyers.' },
];

export const buyerProcess = [
  [
    "Post your request",
    "Share make, model, trim, color, and how far you will travel—or let Sera build it from a conversation."
  ],
  [
    "Matching dealers are notified",
    "Dealers inside your radius who can deliver the car see the request. Your name and contact details stay hidden."
  ],
  [
    "Quotes come to you",
    "Each dealer submits an itemized out-the-door quote covering vehicle, tax, title, licence, and fees."
  ],
  [
    "Compare, negotiate, accept",
    "Quotes are ranked by final price. Compare with Sera, negotiate in-platform, and accept the offer you prefer."
  ]
];

export const dealerProcess = [
  [
    "Request Enters the System",
    "A buyer specifies their exact car—make, model, and trim—and it’s instantly logged to the network. No cold calling required."
  ],
  [
    "Dashboard Flags the Match",
    "Matching requests appear against your live inventory instantly, eliminating the need to manually triage lead lists."
  ],
  [
    "You Set the Price",
    "Set your out-the-door quote against your margin targets. The dashboard displays your win probability before you even submit."
  ],
  [
    "Deal Closes, Books Update",
    "If the buyer accepts your offer, you receive their full contact details so you can finalize the deal in person."
  ]
];

export const buyerJourney = [
  [
    "Post a request",
    "Tell dealers the car, budget and timeframe, or let Sera build the request with you. Your details stay private."
  ],
  [
    "Quote accepted",
    "Compare itemized offers and accept the one you like. Only you can accept, and your dealer’s contact details unlock."
  ],
  [
    "Chat process",
    "Talk it through in the platform. Confirm the paperwork, payment and delivery timing, and watch the order status update."
  ],
  [
    "Meet in person",
    "Meet your dealer to finalize the deal in person, with their full contact details in hand."
  ],
  [
    "Deal closed",
    "You confirm receipt, the deal is marked complete, and the keys are yours."
  ]
];

export const dealerStart = [
  [
    "Apply",
    "Tell us about your dealership: licence number, branch, location, and the brands you carry."
  ],
  [
    "Get verified",
    "Our support team reviews every application, so buyers only ever meet real, licensed dealers. You’ll get an email as soon as you’re approved."
  ],
  [
    "Start quoting",
    "Open your feed, pick the requests you can fill, and send an itemized quote. Buyers do the choosing."
  ]
];

export const seraPoints = [
  "Turn a plain-language chat into a complete, private request",
  "Compare itemized dealer offers side by side",
  "Get answers about specific cars grounded in real data",
  "Approve every request before a single dealer sees it"
];

export const oldWay = [
  "Hours lost on the showroom floor",
  "Cold-calling stale lead lists",
  "Triaging inquiries that never convert",
  "Teaser prices that unravel at the desk",
  "Buyers who ghost after one call"
];

export const newWay = [
  "One number you choose, then you’re done",
  "Matches flagged against your live inventory",
  "Itemized out-the-door quotes buyers can compare",
  "Win probability before you hit send",
  "Contact details the moment a buyer accepts"
];

export const buyerFeatures = [
  [
    "Free, start to finish",
    "It never costs you a cent. Dealers pay only when a deal closes, so they’re rewarded for winning your business with a competitive offer, not for chasing you."
  ],
  [
    "Private until you choose",
    "Dealers quote on the car, your budget and your area, not on who you are. Your name, phone and email stay hidden through every offer and chat, so no dealer can call or email you until you accept a quote."
  ],
  [
    "Negotiate in-platform",
    "Chat with any dealer about their quote and keep the whole conversation in one place."
  ],
  [
    "Trade-in and financing, one number",
    "Add them to your request and every dealer folds them into a single total."
  ],
  [
    "Verified dealers only",
    "Only approved dealerships can see your request or send you a quote."
  ],
  [
    "Offers that re-rank in real time",
    "When a dealer revises their price, your leaderboard updates instantly. No refreshing, no phone tag, just the best total at the top."
  ]
];

export const dealerFeatures = [
  [
    "Zero cold leads",
    "Every request is a real person who shared the exact car, location, and timeframe. Nothing to qualify and nothing to chase—just demand you can fill."
  ],
  [
    "Matched to your lot",
    "Requests inside your radius for the brands you carry rise to the top of your feed."
  ],
  [
    "Know your odds first",
    "See your win probability before you submit, then adjust the number with confidence."
  ],
  [
    "One itemized number",
    "Quote vehicle, tax, title, and fees line by line. The out-the-door total is what competes."
  ],
  [
    "Contacts on acceptance",
    "Buyers stay private while you compete. Once they accept, their full details are yours."
  ],
  [
    "Dealer membership",
    "One flat price for the year. Start free, then keep quoting on every buyer request that fits your lot, with no limit on how many quotes you send."
  ]
];

export const buyerHero = [
  "Your car.",
  "Their best offer.",
  "Stop chasing listings. Tell verified dealers what you want and let clear, itemized offers come to you."
];

export const dealerHero = [
  "No More Hours on the Floor.",
  "Just a Number You Choose.",
  "Deal&Drive sends you real buyers who already know the exact car they want. See the match on your dashboard, set one itemized out-the-door price, and let the buyer decide—no cold calls, no lead lists, no waiting around the showroom."
];

