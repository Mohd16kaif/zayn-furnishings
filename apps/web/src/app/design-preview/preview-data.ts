export type PreviewImages = {
  hero: string | null;
  rooms: Array<string | null>;
  craft: string | null;
  promo: string | null;
};

export type Room = {
  name: string;
  pieces: string;
  tone: 1 | 2 | 3 | 4 | 5 | 6;
};

export type Product = {
  name: string;
  category: string;
  price: string;
  salePrice?: string;
  soldOut?: boolean;
  tone: 1 | 2 | 3 | 4 | 5 | 6;
};

export type Testimonial = {
  quote: string;
  name: string;
  meta: string;
  initials: string;
};

export const navLinks = [
  { label: "Living Room", href: "#rooms", mega: true },
  { label: "Bedroom", href: "#rooms" },
  { label: "Dining", href: "#rooms" },
  { label: "Office", href: "#rooms" },
  { label: "Outdoor", href: "#rooms" },
  { label: "Decor", href: "#rooms" },
  { label: "Sale", href: "#featured", sale: true },
];

export const megaColumns = [
  {
    title: "Seating",
    links: [
      "Sofas & Sectionals",
      "Chairs & Recliners",
      "Benches & Ottomans",
      "Accent Seating",
      "Leather Seating",
      "Modular Collections",
    ],
  },
  {
    title: "Tables & Storage",
    links: [
      "Coffee Tables",
      "Side Tables",
      "Console Tables",
      "Media Cabinets",
      "Bookcases",
      "Sculptural Storage",
    ],
  },
  {
    title: "Curated Edits",
    links: [
      "The Walnut Edit",
      "Quiet Neutrals",
      "Morning Light",
      "Heritage Weaves",
      "Small Spaces",
      "New Arrivals",
    ],
  },
];

export const rooms: Room[] = [
  { name: "Living Room", pieces: "142 pieces", tone: 1 },
  { name: "Bedroom", pieces: "86 pieces", tone: 2 },
  { name: "Dining", pieces: "64 pieces", tone: 3 },
  { name: "Office", pieces: "48 pieces", tone: 4 },
  { name: "Outdoor", pieces: "37 pieces", tone: 5 },
  { name: "Decor", pieces: "210 pieces", tone: 6 },
];

export const products: Product[] = [
  {
    name: "SAMPLE - Aldwyn Sofa",
    category: "Living Room · Walnut",
    price: "$2,480",
    salePrice: "$2,180",
    tone: 1,
  },
  {
    name: "SAMPLE - Marlowe Lounge Chair",
    category: "Living Room · Bouclé",
    price: "$980",
    tone: 2,
  },
  {
    name: "SAMPLE - Haven Dining Table",
    category: "Dining · Solid Oak",
    price: "$1,760",
    salePrice: "$1,520",
    tone: 3,
  },
  {
    name: "SAMPLE - Isolde Bed",
    category: "Bedroom · Upholstered",
    price: "$1,940",
    soldOut: true,
    tone: 4,
  },
  {
    name: "SAMPLE - Wren Writing Desk",
    category: "Office · Ash & Brass",
    price: "$1,120",
    tone: 5,
  },
  {
    name: "SAMPLE - Sable Console",
    category: "Decor · Travertine",
    price: "$740",
    salePrice: "$610",
    tone: 6,
  },
];

export const testimonials: Testimonial[] = [
  {
    quote:
      "The sofa arrived wrapped like a gift, and the delivery team placed it exactly where we wanted it. It feels like furniture we will keep for decades.",
    name: "Sample Customer",
    meta: "Austin, TX · Aldwyn Sofa",
    initials: "SC",
  },
  {
    quote:
      "Quiet, warm, beautifully made. The walnut console anchors our entry in a way I did not expect. Every detail feels considered.",
    name: "Sample Client",
    meta: "Portland, OR · Sable Console",
    initials: "SC",
  },
  {
    quote:
      "Working with the design team was effortless. The room feels collected rather than decorated, which is exactly what we asked for.",
    name: "Sample Guest",
    meta: "Charleston, SC · Full room design",
    initials: "SG",
  },
];

export const faqs = [
  {
    question: "How does white-glove delivery work?",
    answer:
      "Our delivery partners bring each piece into your room of choice, place it where you would like, and remove all packaging. Complimentary white-glove delivery applies to qualifying orders within the contiguous United States.",
  },
  {
    question: "What is your return policy?",
    answer:
      "Stocked pieces may be returned within 30 days of delivery in their original condition. Made-to-order and clearance pieces are final sale. We will arrange the pickup and walk you through every step.",
  },
  {
    question: "Are your materials responsibly sourced?",
    answer:
      "We work with mills and workshops that share our standards for responsible forestry, low-impact finishes, and fair labor. Wood provenance is listed on each product page, and our linens are OEKO-TEX certified.",
  },
  {
    question: "Do you offer trade and design services?",
    answer:
      "Yes. Our in-house design studio offers room planning, fabric guidance, and trade pricing. Book a complimentary consultation and we will prepare a considered proposal for your space.",
  },
  {
    question: "How long will my order take?",
    answer:
      "In-stock pieces typically ship within 5 to 7 business days. Made-to-order upholstery is hand-built to your specification and arrives in 8 to 12 weeks. You will receive updates at every milestone.",
  },
];

export const footerColumns = [
  {
    title: "Shop",
    links: ["Living Room", "Bedroom", "Dining", "Office", "Outdoor", "Sale"],
  },
  {
    title: "Company",
    links: ["Our Story", "Craftsmanship", "Design Services", "Trade Program", "Journal", "Careers"],
  },
  {
    title: "Care",
    links: ["Delivery & Assembly", "Returns", "Care Guide", "Warranty", "Contact", "FAQ"],
  },
];

export const paymentLabels = [
  "Visa",
  "Mastercard",
  "Amex",
  "Discover",
  "Affirm",
  "PayPal",
];
