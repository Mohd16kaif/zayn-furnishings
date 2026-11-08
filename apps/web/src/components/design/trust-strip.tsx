import { CardIcon, ReturnIcon, ShieldIcon, TruckIcon } from "./icons";

const items = [
  {
    title: "Free delivery",
    copy: "White-glove on orders over $1,999",
    icon: TruckIcon,
  },
  {
    title: "Easy returns",
    copy: "30 days to live with it",
    icon: ReturnIcon,
  },
  {
    title: "Secure checkout",
    copy: "Encrypted, always",
    icon: ShieldIcon,
  },
  {
    title: "Financing options",
    copy: "Flexible monthly plans",
    icon: CardIcon,
  },
];

export function TrustStrip() {
  return (
    <section className="zf-trust" id="trust" aria-label="Store guarantees">
      <div className="zf-container">
        <div className="zf-trust__grid">
          {items.map((item) => {
            const Icon = item.icon;
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
