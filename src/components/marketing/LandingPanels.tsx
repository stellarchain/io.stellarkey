/*
 * The landing's panel system. Every surface that used to be a screenshot is
 * drawn here in the page's own chrome — the same .demo card and .rows/.keys/.qr
 * primitives the live demos use. Values are representative; the brand marks
 * (the Stellar glyph, the shield notch) keep their exact shipped geometry.
 */
import { STELLAR_MARK_PATH } from "@/components/icons";

const tick = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);
const arrowOut = (
  <svg className="ar" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg>
);
const arrowIn = (
  <svg className="ar" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 7 7 17" /><path d="M16 17H7V8" /></svg>
);

/** The shield notch at its shipped geometry: blue shield, white official glyph. */
function ShieldNotch() {
  return (
    <span className="notch" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="#0A84FF" />
        <path transform="translate(6.24 4.98) scale(0.48)" d={STELLAR_MARK_PATH} fill="#ffffff" />
      </svg>
    </span>
  );
}

function Pane({ label, dot, tag, wide, children }: {
  label: string;
  dot?: "live" | "done";
  tag?: { text: string; tone: "j" | "b" };
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "demo pane" : "demo pane p-s"}>
      <div className="bar">
        <b>{label}</b>
        {tag ? <span className={`tag ${tag.tone}`}>{tag.text}</span> : dot ? <span className={`dot ${dot}`} /> : null}
      </div>
      {children}
    </div>
  );
}

/* ── wallet ── */

export function PanelBalance() {
  return (
    <Pane label="wallet // balance" dot="done">
      <div className="pbody">
        <div className="amount">10,100 <span className="cur">XLM</span></div>
        <span className="pill">≈ $1,789.95 USD</span>
        <div className="acts">
          <div className="go"><i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 2 11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></svg></i>Send</div>
          <div><i>{arrowIn}</i>Receive</div>
          <div><i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 16V4m0 0L3 8m4-4 4 4" /><path d="M17 8v12m0 0 4-4m-4 4-4-4" /></svg></i>Swap</div>
          <div><i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></i>Add</div>
        </div>
      </div>
    </Pane>
  );
}

export function PanelMarket() {
  return (
    <Pane label="market // xlm" dot="live">
      <div className="pbody">
        <div className="amount" style={{ fontSize: "2rem" }}>$0.1772</div>
        <div className="sub"><b style={{ color: "var(--jade)", fontWeight: 400 }}>▲ 2.1%</b> · past 7 days</div>
        <div className="spark" aria-hidden="true">
          <svg viewBox="0 0 300 64" preserveAspectRatio="none">
            <path d="M0 46 L25 44 L50 48 L75 38 L100 40 L125 30 L150 34 L175 24 L200 28 L225 18 L250 22 L275 12 L300 16" fill="none" stroke="var(--jade)" strokeWidth="1.5" />
            <path d="M0 46 L25 44 L50 48 L75 38 L100 40 L125 30 L150 34 L175 24 L200 28 L225 18 L250 22 L275 12 L300 16 L300 64 L0 64 Z" fill="rgb(79 201 141/.07)" stroke="none" />
          </svg>
        </div>
        <div className="rows">
          <div><span>7-day low</span><b>$0.1701</b></div>
          <div><span>7-day high</span><b>$0.1801</b></div>
        </div>
      </div>
    </Pane>
  );
}

export function PanelSend() {
  return (
    <Pane label="send // payment" dot="live">
      <div className="pbody">
        <div className="amount" style={{ fontSize: "2rem" }}>25 <span className="cur">XLM</span></div>
        <div className="rows" style={{ marginTop: ".9rem" }}>
          <div><span>To</span><b>GDJZ … 46UH</b></div>
          <div><span>Memo</span><b>Coffee</b></div>
          <div><span>Network fee</span><b className="g">0.00001 XLM</b></div>
          <div><span>Settles in</span><b className="j">~5 seconds</b></div>
        </div>
        <div className="mockbtn">Send</div>
      </div>
    </Pane>
  );
}

export function PanelSecurity() {
  return (
    <Pane label="security // health" dot="done">
      <div className="pbody">
        <div className="ringwrap">
          <div className="score" aria-hidden="true">
            <svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--raise)" strokeWidth="2.6" /><circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--jade)" strokeWidth="2.6" strokeDasharray="100 100" strokeLinecap="round" /></svg>
            <b>100</b>
          </div>
          <div className="tix">
            <div>{tick}Keys encrypted on this device</div>
            <div>{tick}Recovery phrase confirmed</div>
            <div>{tick}Auto-lock armed</div>
          </div>
        </div>
      </div>
    </Pane>
  );
}

/* ── till ── */

export function PanelKeypad() {
  return (
    <Pane label="till // keypad" dot="live">
      <div className="pbody">
        <div className="amount"><span className="cur">€</span>2.50</div>
        <div className="sub">Shift 1 · Front counter</div>
        <div className="keys">
          <span>1</span><span>2</span><span>3</span>
          <span>4</span><span>5</span><span>6</span>
          <span>7</span><span>8</span><span>9</span>
          <span>00</span><span>0</span><span>⌫</span>
        </div>
        <div className="mockbtn">Add to ticket</div>
      </div>
    </Pane>
  );
}

export function PanelCharge() {
  return (
    <Pane label="till // charge" dot="live">
      <div className="pbody">
        <div className="amount" style={{ fontSize: "2rem" }}><span className="cur">€</span>9.20</div>
        <div className="sub">= 42.7459510 XLM</div>
        <div className="qr"><img src="/marketing/demo-qr.svg" alt="Stellar payment request QR code" width={148} height={148} loading="lazy" decoding="async" /></div>
        <div className="rows">
          <div><span>Payment route</span><b>Included in address</b></div>
        </div>
        <div className="wait"><span className="dot live" />watching for payment · 9:56</div>
      </div>
    </Pane>
  );
}

export function PanelReceipt() {
  return (
    <Pane label="order // NSC-O-1001" tag={{ text: "Paid", tone: "j" }}>
      <div className="pbody">
        <div className="lines">
          <div><span><span className="q">2 ×</span> Flat white</span><span>€ 6.40</span></div>
          <div><span><span className="q">1 ×</span> Croissant</span><span>€ 2.80</span></div>
          <div><span className="q">VAT 20% included</span><span className="q">€ 1.53</span></div>
          <div><span className="tot">Total</span><span className="tot">€ 9.20</span></div>
        </div>
        <div className="rows" style={{ marginTop: ".8rem" }}>
          <div><span>Received</span><b className="j">42.7459510 XLM</b></div>
          <div><span>Transaction</span><b>7f9c … 3e21</b></div>
          <div><span>Ledger</span><b>4,433,868</b></div>
        </div>
      </div>
    </Pane>
  );
}

export function PanelStats() {
  return (
    <Pane label="today // friday" dot="done" wide>
      <div className="stats">
        <div><em>Takings</em><b className="j">€ 231.50</b></div>
        <div><em>Orders</em><b>47</b></div>
        <div><em>Tips</em><b>€ 18.20</b></div>
        <div><em>Refunds</em><b>€ 0.00</b></div>
      </div>
    </Pane>
  );
}

export function PanelOrders() {
  return (
    <Pane label="orders // latest">
      <div className="pbody">
        <div className="rows">
          <div><span>14:32 · Ana</span><b className="j">€ 9.20</b></div>
          <div><span>14:18 · Ana</span><b className="j">€ 3.20</b></div>
          <div><span>13:55 · Marco</span><b className="j">€ 12.60</b></div>
          <div><span>13:41 · Marco</span><b className="j">€ 6.40</b></div>
        </div>
      </div>
    </Pane>
  );
}

export function PanelHours() {
  return (
    <Pane label="takings // by hour">
      <div className="pbody">
        <div className="bars" aria-hidden="true">
          <i style={{ height: "18%" }} /><i style={{ height: "34%" }} /><i style={{ height: "52%" }} /><i style={{ height: "70%" }} /><i className="hot" style={{ height: "100%" }} /><i style={{ height: "64%" }} /><i style={{ height: "40%" }} /><i style={{ height: "26%" }} />
        </div>
        <div className="bars-x" aria-hidden="true"><span>9</span><span>10</span><span>11</span><span>12</span><span>13</span><span>14</span><span>15</span><span>16</span></div>
        <div className="sub" style={{ marginTop: ".8rem" }}>the 13:00 hour, carrying the day</div>
      </div>
    </Pane>
  );
}

export function PanelCatalogue() {
  return (
    <Pane label="catalogue // coffee">
      <div className="pbody">
        <div className="rows">
          <div><span>Flat white</span><b>€ 3.20</b></div>
          <div><span>Espresso</span><b>€ 2.10</b></div>
          <div><span>Croissant</span><b>€ 2.80</b></div>
          <div><span>Beans · 250 g</span><b>€ 9.50</b></div>
        </div>
      </div>
    </Pane>
  );
}

export function PanelCustomers() {
  return (
    <Pane label="customers // regulars">
      <div className="pbody">
        <div className="rows">
          <div><span>M. K.</span><b>12 visits · € 96.20</b></div>
          <div><span>A. R.</span><b>9 visits · € 61.40</b></div>
          <div><span>Walk-ins</span><b>26 this week</b></div>
        </div>
      </div>
    </Pane>
  );
}

export function PanelStandout() {
  return (
    <Pane label="what // stands out">
      <div className="pbody">
        <div className="obs">
          <p><b>Tuesday is your quietest day.</b> Half the takings of Friday, same opening hours.</p>
          <p><b>The 13:00 hour pays the rent.</b> One lunch hour is 22% of the week.</p>
        </div>
      </div>
    </Pane>
  );
}

export function PanelTax() {
  return (
    <Pane label="tax // this period">
      <div className="pbody">
        <div className="rows">
          <div><span>VAT 20%</span><b>€ 12.40</b></div>
          <div><span>VAT 5%</span><b>€ 3.10</b></div>
          <div><span>Refunds netted</span><b>€ 0.00</b></div>
          <div><span>Export</span><b className="g">CSV, any range</b></div>
        </div>
      </div>
    </Pane>
  );
}

export function PanelMix() {
  return (
    <Pane label="asset // mix">
      <div className="pbody">
        <div className="mix">
          <div><div className="mh"><span>XLM</span><span>78%</span></div><i style={{ "--w": "78%" } as React.CSSProperties} /></div>
          <div className="u"><div className="mh"><span>USDC</span><span>22%</span></div><i style={{ "--w": "22%" } as React.CSSProperties} /></div>
        </div>
        <div className="sub" style={{ marginTop: "1rem" }}>at the rate each sale settled</div>
      </div>
    </Pane>
  );
}

/* ── private ── */

export function PanelFeed() {
  return (
    <Pane label="activity // one feed" dot="done">
      <div className="pbody">
        <div className="feed">
          <div>
            <span className="lead"><span className="c out">{arrowOut}</span><ShieldNotch /></span>
            <span className="t"><b>Sent privately</b><span>2m ago · Coffee fund</span></span>
            <span className="a">−12 XLM</span>
          </div>
          <div>
            <span className="lead"><span className="c in">{arrowIn}</span><ShieldNotch /></span>
            <span className="t"><b>Received privately</b><span>Just now</span></span>
            <span className="a j">+12 XLM</span>
          </div>
          <div>
            <span className="lead"><span className="c plain">{arrowOut}</span></span>
            <span className="t"><b>Sent</b><span>1h ago · GDJZ … 46UH</span></span>
            <span className="a">−2.5 XLM</span>
          </div>
        </div>
        <div className="sub" style={{ marginTop: ".7rem" }}>the shield marks a private payment · amounts shown only on this device</div>
      </div>
    </Pane>
  );
}

export function PanelDeal() {
  return (
    <Pane label="private // the deal">
      <div className="pbody" style={{ paddingTop: ".9rem" }}>
        <div className="deal">
          <div className="prv"><em>Stays encrypted</em><u>The amount</u><u>The recipient</u><u>The memo</u></div>
          <div className="pub"><em>Stays public</em><u>Money moving in or out</u><u>The network fee</u><u>The timing</u></div>
        </div>
        <div className="sub" style={{ marginTop: ".8rem" }}>stated before you turn it on — not in the small print</div>
      </div>
    </Pane>
  );
}

export function PanelAddReview() {
  return (
    <Pane label="add // review" dot="live">
      <div className="pbody">
        <div className="amount" style={{ fontSize: "2rem" }}>+100 <span className="cur">XLM</span></div>
        <div className="sub">public → private</div>
        <div className="rows" style={{ marginTop: ".9rem" }}>
          <div><span>Network fee</span><b className="g">0.4271827 XLM · public</b></div>
          <div><span>Balance before</span><b>0 XLM</b></div>
          <div><span>Balance after</span><b className="j">100 XLM</b></div>
        </div>
        <div className="mockbtn">Confirm</div>
      </div>
    </Pane>
  );
}

export function PanelReceive() {
  return (
    <Pane label="receive // private" tag={{ text: "Shielded", tone: "b" }}>
      <div className="pbody">
        <div className="qr"><img src="/marketing/demo-qr.svg" alt="Shielded address QR code" width={148} height={148} loading="lazy" decoding="async" /></div>
        <div className="vcode"><em>Verification code</em><b>FC42 C9CF</b></div>
        <div className="sub" style={{ textAlign: "center", marginTop: ".45rem" }}>the sender sees the same code before paying</div>
        <div className="addr"><span>tks1 … n8d6</span></div>
      </div>
    </Pane>
  );
}

export function PanelSendPrivate() {
  return (
    <Pane label="send // private" dot="live">
      <div className="pbody">
        <div className="amount" style={{ fontSize: "2rem" }}>12 <span className="cur">XLM</span></div>
        <div className="rows" style={{ marginTop: ".9rem" }}>
          <div><span>To</span><b className="j">FC42 C9CF ✓</b></div>
          <div><span>Private memo</span><b>Coffee fund</b></div>
        </div>
        <div className="mockbtn">Review Private Send</div>
      </div>
    </Pane>
  );
}

export function PanelSendReview() {
  return (
    <Pane label="send // private review" dot="live">
      <div className="pbody">
        <div className="rows">
          <div><span>To</span><b className="j">FC42 C9CF ✓</b></div>
          <div><span>Amount</span><b>12 XLM · encrypted</b></div>
          <div><span>Memo</span><b>encrypted</b></div>
          <div><span>Network fee</span><b className="g">0.4847157 XLM · public</b></div>
          <div><span>Proof</span><b>built on this device</b></div>
        </div>
        <div className="mockbtn">Confirm Send</div>
      </div>
    </Pane>
  );
}
