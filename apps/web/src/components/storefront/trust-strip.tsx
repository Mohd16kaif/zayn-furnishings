import type { ComponentType, SVGProps } from "react";
import {
  CardIcon,
  ReturnIcon,
  ShieldIcon,
  TruckIcon,
} from "@/components/design/icons";

export type TrustIcon = "truck" | "return" | "shield" | "card";

export type TrustItem = {
  title: string;
  copy: string;
  icon: TrustIcon;
};

const iconComponents: Record<
  TrustIcon,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  truck: TruckIcon,
  return: ReturnIcon,
  shield: ShieldIcon,
  card: CardIcon,
};

const PREVIEW_ITEMS: TrustItem[] = [
  {
    title: "Free delivery",
    copy: "White-glove delivery available",
    icon: "truck",
  },
  {
    title: "Easy returns",
    copy: "30 days to live with it",
    icon: "return",
  },
  {
    title: "Secure checkout",
    copy: "Encrypted, always",
    icon: "shield",
  },
  {
    title: "Financing options",
    copy: "Flexible monthly plans",
    icon: "card",
  },
];

export function TrustStrip({ items = PREVIEW_ITEMS }: { items?: TrustItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="zf-trust" id="trust" aria-label="Store guarantees">
      <div className="zf-container">
        <div className="zf-trust__grid">
          {items.map((item) => {
            const Icon = iconComponents[item.icon];

            return (
              <div className="zf-trust__item" key={item.title}>
                <span className="zf-trust__icon" aria-hidden="true">
                  <Icon />
                </span>
                <span>
                  <span className="zf-trust__title">{item.title}</span>
                  <span className="zf-trust__copy">{item.copy}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
