import type { Metadata } from "next";
import type { PublicCategoryNode, PublicContentBlock } from "@zayn/shared";
import {
  getCategories,
  getContentHome,
  getProducts,
  getSettings,
} from "@/lib/publicApi";
import { formatCents } from "@/lib/money";
import { Hero, type HeroSlide } from "@/components/storefront/hero";
import { TrustStrip, type TrustItem } from "@/components/storefront/trust-strip";
import { Rooms, type RoomTile } from "@/components/storefront/rooms";
import { Signature } from "@/components/storefront/signature";
import {
  FeaturedCarousel,
} from "@/components/storefront/featured-carousel";
import type { ProductCardData } from "@/components/storefront/product-card";
import { Craft, type CraftStat } from "@/components/storefront/craft";
import { Promo, type PromoCard } from "@/components/storefront/promo";
import { InfoCards, type InfoCard } from "@/components/storefront/info-cards";
import { Faq, type FaqItem } from "@/components/storefront/faq";

export const instant = false;

export const metadata: Metadata = {
  title: {
    absolute: "Zayn Furnishings | Quiet luxury furniture for the American home",
  },
  description:
    "Considered furniture for the rooms you use every day. Shop living room, bedroom, dining, office, and outdoor pieces with live availability and delivery to your ZIP code.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Zayn Furnishings | Quiet luxury furniture for the American home",
    description:
      "Considered furniture for the rooms you use every day. Live availability and delivery to your ZIP code.",
    url: "/",
    siteName: "Zayn Furnishings",
    type: "website",
  },
};

const TONES = [1, 2, 3, 4, 5, 6] as const;

function toneFor(index: number): (typeof TONES)[number] {
  return TONES[index % TONES.length];
}

/** Whole-dollar display for the free-delivery threshold ("$1,999"). */
function formatThreshold(cents: number): string {
  return formatCents(cents).replace(/\.00$/, "");
}

function blocksOf(
  content: Record<string, PublicContentBlock[]>,
  type: string,
): PublicContentBlock[] {
  const blocks = content[type];

  return Array.isArray(blocks) ? blocks : [];
}

function slugFromLink(link: string | null): string | null {
  if (!link) {
    return null;
  }

  const match = /^\/c\/([^/?#]+)/.exec(link);

  return match ? match[1] : null;
}

function categoryCounts(
  tree: PublicCategoryNode[],
): Map<string, number> {
  const counts = new Map<string, number>();

  function walk(nodes: PublicCategoryNode[]) {
    for (const node of nodes) {
      counts.set(node.slug, node.product_count);
      walk(node.children);
    }
  }

  walk(tree);

  return counts;
}

function faqJsonLd(faqs: FaqItem[]) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  }).replace(/</g, "\\u003c");
}

export default async function HomePage() {
  const [settingsResult, contentResult, categoriesResult, featuredResult] =
    await Promise.all([
      getSettings(),
      getContentHome(),
      getCategories(),
      getProducts({ featured: true, pageSize: 8 }),
    ]);

  const settings = settingsResult.data;
  const content = contentResult.data;
  const categoryTree = categoriesResult.data;

  let featuredItems = featuredResult.data.items;

  if (featuredItems.length === 0) {
    const newest = await getProducts({ sort: "newest", pageSize: 8 });
    featuredItems = newest.data.items;
  }

  const allProducts = await getProducts({ pageSize: 1 });

  const counts = categoryCounts(categoryTree);

  const heroSlides: HeroSlide[] = blocksOf(content, "hero")
    .filter((block) => Boolean(block.title))
    .map((block) => ({
      title: block.title as string,
      subtitle: block.subtitle,
      image: block.image_url,
      buttonText: block.button_text,
      buttonLink: block.link_url,
    }));

  const trustItems: TrustItem[] = [
    {
      title: "Delivery",
      copy: `Free delivery over ${formatThreshold(
        settings.free_delivery_threshold_cents,
      )}`,
      icon: "truck",
    },
    {
      title: "Easy returns",
      copy: "A simple, straightforward process",
      icon: "return",
    },
    {
      title: "Secure checkout",
      copy: "Encrypted, always",
      icon: "shield",
    },
  ];

  if (settings.show_financing) {
    trustItems.push({
      title: "Financing options",
      copy: "Flexible monthly plans",
      icon: "card",
    });
  }

  const roomTiles: RoomTile[] = blocksOf(content, "room_tile")
    .filter((block) => Boolean(block.title))
    .map((block, index) => {
      const slug = slugFromLink(block.link_url);
      const count = slug ? counts.get(slug) : undefined;

      return {
        name: block.title as string,
        href: block.link_url ?? "#rooms",
        count:
          count === undefined
            ? null
            : `${count} ${count === 1 ? "piece" : "pieces"}`,
        tone: toneFor(index),
        image: block.image_url,
      };
    });

  const promoBlock = blocksOf(content, "promo_card")[0];
  const promoCard: PromoCard | null =
    promoBlock && promoBlock.title
      ? {
          eyebrow: promoBlock.subtitle,
          title: promoBlock.title,
          body: promoBlock.body,
          buttonText: promoBlock.button_text,
          linkUrl: promoBlock.link_url,
          image: promoBlock.image_url,
        }
      : null;

  const infoCards: InfoCard[] = blocksOf(content, "info_card")
    .filter((block) => Boolean(block.title && block.body))
    .map((block) => ({
      title: block.title as string,
      body: block.body as string,
      linkUrl: block.link_url,
      linkText: block.button_text,
    }));

  const faqs: FaqItem[] = blocksOf(content, "faq")
    .filter((block) => Boolean(block.title && block.body))
    .map((block) => ({
      question: block.title as string,
      answer: block.body as string,
    }));

  const productCards: ProductCardData[] = featuredItems.map(
    (product, index) => ({
      id: product.id,
      name: product.name,
      slug: product.slug,
      category: product.category_name,
      priceCents: product.price_cents,
      salePriceCents: product.sale_price_cents,
      inStock: product.in_stock,
      imageUrl: product.primary_image_url,
      tone: toneFor(index),
    }),
  );

  const craftStats: CraftStat[] = [];

  if (allProducts.ok && allProducts.data.total > 0) {
    craftStats.push({
      value: allProducts.data.total,
      label: "curated pieces",
    });
  }

  if (categoryTree.length > 0) {
    craftStats.push({
      value: categoryTree.length,
      label: "collections",
    });
  }

  const organizationJsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: settings.store_name,
    url: "/",
  }).replace(/</g, "\\u003c");

  // With every public endpoint down, render only the shell (the header shows
  // a friendly notice); no empty sections, no static marketing filler.
  const apiDown =
    !contentResult.ok && !categoriesResult.ok && !featuredResult.ok;

  if (apiDown) {
    return null;
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: organizationJsonLd }}
      />
      {faqs.length > 0 ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: faqJsonLd(faqs) }}
        />
      ) : null}

      {heroSlides.length > 0 ? <Hero slides={heroSlides} /> : null}
      <TrustStrip items={trustItems} />
      <Rooms tiles={roomTiles} />
      <Signature />
      <FeaturedCarousel
        products={productCards}
        heading="Pieces with presence, made for everyday living."
        lede={null}
      />
      {craftStats.length === 2 ? (
        <Craft stats={craftStats} image="/images/home/craft.jpg" />
      ) : null}
      {promoCard ? <Promo card={promoCard} /> : null}
      <InfoCards cards={infoCards} />
      <Faq faqs={faqs} />
    </>
  );
}
