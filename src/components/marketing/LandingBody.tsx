/*
 * The landing page markup. Static by design: the demo effects live in
 * LandingClient and the calculator is a small client leaf, so this stays a
 * server component.
 *
 * The screenshots are pre-sized WebP crops served from a static export, where
 * next/image can only pass them through unchanged, so a plain <img> with real
 * dimensions is the lighter and more honest choice.
 */
/* eslint-disable @next/next/no-img-element */
import { FeeCalculator } from "./FeeCalculator";

export function LandingBody() {
  return (
    <>

      <section className="sheet">
        <div className="hero-grid">
          <div>
            <p className="mono-label">a stellar wallet<span className="sep">{"//"}</span>with a card machine in it</p>
            <h1 className="display" style={{ marginTop: "1.6rem" }}>Your keys never<br />leave this device.</h1>
            <p className="lede"><strong>StellarKey is two things in one app.</strong> A self-custody Stellar wallet, where the vault is encrypted in your browser and every signature is shown to you before it happens. And a point of sale, so a shop can take payments straight into that same wallet, with no processor in the middle.</p>
            <div className="cta-row">
              <a className="btn btn-gold" href="/app">Open the app</a>
              <a className="btn btn-line" href="#till">See the till</a>
            </div>
            <p className="hero-foot">Horizon for the chain · this device for everything else</p>
          </div>

          <div className="demo rv" id="sign" data-demo="sign">
            <div className="bar"><span className="dot" data-dot></span><b data-label>signing a payment</b>
              <button className="replay" data-replay type="button">Replay</button></div>
            <div className="stage" style={{ height: "21rem" }}>
              <div className="step" data-step="0">
                <div className="sub" style={{ marginBottom: ".7rem" }}>VAULT · LOCKED</div>
                <div className="rows">
                  <div><span>encryption</span><b>AES-256 · PBKDF2-GCM</b></div>
                  <div><span>stored</span><b>this browser only</b></div>
                  <div><span>uploaded</span><b className="g">never</b></div>
                </div>
                <div className="pinrow" data-pin><i></i><i></i><i></i><i></i><i></i><i></i></div>
                <div className="sub" style={{ textAlign: "center", marginTop: ".7rem" }}>unlocking…</div>
              </div>
              <div className="step" data-step="1">
                <div className="sub" style={{ marginBottom: ".7rem" }}>BEFORE YOU SIGN</div>
                <div className="rows">
                  <div><span>operation</span><b>payment</b></div>
                  <div><span>to</span><b>GC33 RABA … 7604</b></div>
                  <div><span>amount</span><b className="g">120.0000000 XLM</b></div>
                  <div><span>memo</span><b>Coffee</b></div>
                  <div><span>network fee</span><b>0.00001 XLM</b></div>
                </div>
                <div className="wait"><span className="dot live"></span>nothing hidden · nothing added</div>
              </div>
              <div className="step" data-step="2">
                <div className="paid">
                  <div className="tick"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.6 9.2 18 20 6.6"/></svg></div>
                  <div className="big">Signed on this device</div>
                  <div className="amt">key never left the vault</div>
                </div>
                <div className="rows" style={{ marginTop: "1.1rem" }}>
                  <div><span>signed by</span><b>your key, locally</b></div>
                  <div><span>submitted to</span><b>Horizon</b></div>
                </div>
              </div>
              <div className="step" data-step="3">
                <div className="sub" style={{ marginBottom: ".5rem" }}>ON THE LEDGER</div>
                <div className="rows">
                  <div><span>transaction</span><b className="g">ef3a 5dd7 … b94f</b></div>
                  <div><span>ledger</span><b>4,369,215</b></div>
                  <div><span>status</span><b className="j">confirmed</b></div>
                  <div><span>verifiable by</span><b>anyone, anywhere</b></div>
                </div>
                <div className="wait" style={{ marginTop: ".9rem" }}>you did not have to trust us for any of this</div>
              </div>
            </div>
            <div className="track" data-track><i></i><i></i><i></i><i></i></div>
          </div>
        </div>
      </section>

      <section className="band"><div className="sheet" style={{ paddingTop: "3rem", paddingBottom: "3rem" }}>
        <ul className="rail">
          <li><b>AES-256</b><span>PBKDF2-GCM vault, encrypted here, never uploaded.</span></li>
          <li><b>0</b><span>Accounts, servers or custodians between you and your money.</span></li>
          <li><b>1</b><span>Network dependency. Horizon, the public Stellar API.</span></li>
          <li><b>0 %</b><span>Platform fee at the counter. There is no platform to pay.</span></li>
        </ul>
      </div></section>
      <section className="band" id="what"><div className="sheet" style={{ paddingTop: "3.5rem", paddingBottom: "3.5rem" }}>
        <div className="what rv">
          <div>
            <em>what it is</em>
            <b>A wallet you actually own</b>
            <span>Hold, send, receive and swap Stellar assets. The key is generated and encrypted on your device and never leaves it. No sign-up, no custodian, no company standing between you and your balance.</span>
          </div>
          <div>
            <em>and</em>
            <b>A till that pays into it</b>
            <span>Ring up a sale, show a code, and the customer pays your own account directly. The app watches the public ledger and files the payment against the order. No processor, so no percentage.</span>
          </div>
          <div>
            <em>what it is not</em>
            <b>Not an exchange or a bank</b>
            <span>It does not hold your money, convert to cash, or recover your password. Everything runs on this device against the public Stellar network. That is the point, and it is the trade.</span>
          </div>
        </div>
      </div></section>

      <section className="band" id="wallet"><div className="sheet">
        <div className="head">
          <p className="mono-label">the wallet<span className="sep">{"//"}</span>encrypted on device<span className="sep">{"//"}</span>hardware ready</p>
          <h2 className="display-sm">A wallet that assumes nothing about you.</h2>
          <p className="lede">No account to create, no email to confirm, nobody to ask for your balance back.</p>
        </div>
        <div className="plate rv">
          <div className="duo">
            <div className="comp"><img src="/marketing/w-portfolio.webp" alt="Portfolio card showing a native XLM balance with send, receive, swap and add actions."  width={1332} height={648} loading="lazy" decoding="async" /></div>
            <div className="comp"><img src="/marketing/w-market.webp" alt="XLM market card with the current price, daily low and high, and a seven-day chart."  width={938} height={708} loading="lazy" decoding="async" /></div>
          </div>
        </div>
        <div className="row rv">
          <div>
            <p className="mono-label">signing</p>
            <h3>Every signature reviewed before it happens</h3>
            <p>Destination, amount, memo, fee tier and the exact operations, laid out before anything is signed.</p>
            <ul className="ticks">
              <li>Trezor signing, so the key never touches a browser</li>
              <li>Multi-sig with co-signers, weights and thresholds</li>
              <li>Batch disperse to many recipients in one transaction</li>
            </ul>
          </div>
          <div className="comp"><img src="/marketing/w-send.webp" alt="Send payment sheet with asset, amount, recipient address, fee tiers and a memo field."  width={1152} height={1252} loading="lazy" decoding="async" /></div>
        </div>
        <div className="row flip rv">
          <div>
            <p className="mono-label">custody posture</p>
            <h3>The wallet grades its own security</h3>
            <p>Encryption, auto-lock, recovery state and backup health are scored rather than assumed, so you can see the gap before it matters.</p>
          </div>
          <div className="comp"><img src="/marketing/w-security.webp" alt="Wallet security health scored out of 100 with encryption, seed and auto-lock checks."  width={2000} height={1120} loading="lazy" decoding="async" /></div>
        </div>
      </div></section>
      <section className="band" id="till-intro"><div className="sheet" style={{ paddingTop: "4.5rem", paddingBottom: "0" }}>
        <div className="head">
          <p className="mono-label">act two<span className="sep">{"//"}</span>the same wallet, behind a counter</p>
          <h2 className="display-sm">Then it opens a till.</h2>
          <p className="lede">Merchant Mode turns the wallet into a point of sale. Same keys, same device, same account, with a counter on top. Everything below is optional: the wallet works perfectly well without ever switching it on.</p>
        </div>
      </div></section>

      <section className="band" id="sale"><div className="sheet">
        <div className="head">
          <p className="mono-label">how a sale works<span className="sep">{"//"}</span>four steps<span className="sep">{"//"}</span>no middle</p>
          <h2 className="display-sm">Nothing sits between the customer and your account.</h2>
          <p className="lede">There is no in between, because there is no one in it. The till watches the public ledger and files the payment against the order itself.</p>
        </div>
        <div className="demo inline rv" data-demo="sale">
          <div className="bar"><span className="dot" data-dot></span><b data-label>a sale, start to finish</b>
            <button className="replay" data-replay type="button">Replay</button></div>
          <div className="stage">
            <div className="step" data-step="0">
              <div className="amount"><span className="cur">€</span><span data-amt>0.00</span></div>
              <div className="sub">AMOUNT · COUNTER IPAD</div>
              <div className="keys" data-keys>
                <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span>
                <span>7</span><span>8</span><span>9</span><span>00</span><span>0</span><span>⌫</span>
              </div>
            </div>
            <div className="step" data-step="1">
              <div className="sub" style={{ textAlign: "center", marginBottom: ".2rem" }}>ORDER 1024 · MC-O-1024</div>
              <div className="qr"><img src="/marketing/demo-qr.svg" alt="Stellar payment request" width={148} height={148} /></div>
              <div className="rows">
                <div><span>asking</span><b className="g">22.3755101 XLM</b></div>
                <div><span>memo</span><b className="g">MC-O-1024</b></div>
              </div>
              <div className="wait"><span className="dot live"></span>watching horizon · 9:57</div>
            </div>
            <div className="step" data-step="2">
              <div className="paid">
                <div className="tick"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.6 9.2 18 20 6.6"/></svg></div>
                <div className="big">Paid in full</div>
                <div className="amt">22.3755101 XLM received</div>
              </div>
              <div className="rows" style={{ marginTop: "1.1rem" }}>
                <div><span>matched by</span><b>memo</b></div>
                <div><span>ledger</span><b>4,369,215</b></div>
              </div>
            </div>
            <div className="step" data-step="3">
              <div className="sub" style={{ marginBottom: ".5rem" }}>RECEIPT · ORDER #1024</div>
              <div className="rows">
                <div><span>total</span><b>€ 4.80</b></div>
                <div><span>vat 23 %</span><b>€ 0.90</b></div>
                <div><span>received</span><b className="j">22.3755101 XLM</b></div>
                <div><span>payer</span><b>GC33 RABA … 7604</b></div>
                <div><span>processor fee</span><b className="j">€ 0.00</b></div>
              </div>
            </div>
          </div>
          <div className="track" data-track><i></i><i></i><i></i><i></i></div>
        </div>

        <ol className="steps rv">
          <li><span className="n">01 / ring up</span><h3>Build the ticket</h3><p>Keypad or product tiles, with per-line VAT, modifiers and discounts worked out on device.</p></li>
          <li><span className="n">02 / tip</span><h3>Ask, don’t assume</h3><p>The customer is offered the tip before the code appears, never added quietly after.</p></li>
          <li><span className="n">03 / charge</span><h3>Show the code</h3><p>A SEP-7 request carrying your address, the amount, and a memo unique to this order.</p></li>
          <li><span className="n">04 / settle</span><h3>It files itself</h3><p>The till marks the order paid when the network payment is reported and matched.</p></li>
        </ol>

        <div className="head" style={{ marginTop: "4.5rem" }}>
          <p className="mono-label">and you can check it<span className="sep">{"//"}</span>without trusting us</p>
          <h2 className="display-sm">Every sale leaves a public receipt.</h2>
          <p className="lede">This is the receipt StellarKey produces after a payment is matched. It keeps the order, exact asset amount, payer, transaction hash, memo match, and ledger together so the full on-chain identity can be checked when supplied.</p>
        </div>
        <div className="verify rv">
          <table><tbody>
            <tr><td>order</td><td>#1024 · MC-O-1024</td></tr>
            <tr><td>total</td><td>€ 4.80 · VAT 23 % included</td></tr>
            <tr><td>received</td><td className="j">22.3755101 XLM</td></tr>
            <tr><td>payer</td><td>GC33 RABA … Z03U 7604</td></tr>
            <tr><td>transaction</td><td className="g">ef3a 5dd7 … 016a b94f</td></tr>
            <tr><td>matched by</td><td>memo</td></tr>
            <tr><td>ledger</td><td>4,369,215</td></tr>
          </tbody></table>
        </div>
        <p className="cap-line">representative testnet receipt · values are illustrative</p>

        <div className="row rv">
          <div>
            <p className="mono-label">the counter</p>
            <h3>A till, not a checkout page</h3>
            <p>The ticket builds on the right while the keypad or the catalogue fills it. Staff are roles on this device, gated by a PIN, and every action is attributed to whoever is on shift.</p>
          </div>
          <div className="comp"><img src="/marketing/m-keypad.webp" alt="Point-of-sale keypad with an amount display and an add-to-ticket action."  width={1200} height={924} loading="lazy" decoding="async" /></div>
        </div>
        <div className="row flip rv">
          <div>
            <p className="mono-label">one qr<span className="sep">{"//"}</span>one memo</p>
            <h3>The memo is the reconciliation</h3>
            <p>That reference ties the payment to this order. Matched from the public ledger, on device, with no webhook to receive and nothing to poll but Horizon.</p>
            <ul className="ticks">
              <li>Underpaid and overpaid handled explicitly, not silently</li>
              <li>Anything unmatched lands in a tray instead of disappearing</li>
              <li>Charges keep running while the till serves the next customer</li>
            </ul>
          </div>
          <div className="comp"><img src="/marketing/m-charge.webp" alt="Charge sheet showing the amount in euro and XLM, a countdown, a QR code and the order memo."  width={1152} height={2080} loading="lazy" decoding="async" /></div>
        </div>
        <div className="row rv">
          <div>
            <p className="mono-label">proof</p>
            <h3>A receipt that is also an audit trail</h3>
            <p>Lines, VAT by rate, the payer’s address, the transaction hash, how it was matched and the ledger it closed in, all on one sheet, ready for whoever asks.</p>
          </div>
          <div className="comp"><img src="/marketing/m-receipt.webp" alt="Order receipt showing paid status, line items, VAT, the received XLM amount, payer, transaction hash and ledger number."  width={1152} height={1222} loading="lazy" decoding="async" /></div>
        </div>
      </div></section>
      <section className="band" id="cost"><div className="sheet">
        <div className="head">
          <p className="mono-label">the arithmetic<span className="sep">{"//"}</span>published UK rates<span className="sep">{"//"}</span>no processing fee</p>
          <h2 className="display-sm">Compare processing fees with published card rates.</h2>
          <p className="lede">StellarKey charges no subscription or processing fee. Use these dated assumptions to compare that with common UK in-person card rates.</p>
        </div>
        <FeeCalculator />
      </div></section>
      <section className="band" id="till"><div className="sheet">
        <div className="head">
          <p className="mono-label">records<span className="sep">{"//"}</span>computed locally<span className="sep">{"//"}</span>sent nowhere</p>
          <h2 className="display-sm">And keeps the books where you can reach them.</h2>
        </div>
        <div className="band-strip comp rv"><img src="/marketing/m-strip.webp" alt="Summary strip showing takings today, order count, tips and refunds."  width={2000} height={122} loading="lazy" decoding="async" /></div>
        <p className="cap-line">the same strip opens orders, invoices, customers and insights</p>
        <div className="gal rv">
          <div><div className="comp"><img src="/marketing/m-orders.webp" alt="Order rows showing paid sales with time, staff and amount."  width={2000} height={860} loading="lazy" decoding="async" /></div>
            <h3>Orders</h3><p>Every sale with its payment, its ledger and the memo that matched them.</p></div>
          <div><div className="comp"><img src="/marketing/m-hours.webp" alt="Takings by hour chart."  width={1322} height={820} loading="lazy" decoding="async" /></div>
            <h3>Takings by hour</h3><p>Today against what this weekday normally does, so a quiet afternoon reads as quiet.</p></div>
          <div><div className="comp"><img src="/marketing/m-catalogue.webp" alt="Catalogue rows across categories with prices."  width={2000} height={668} loading="lazy" decoding="async" /></div>
            <h3>Catalogue</h3><p>Products, categories, modifiers, per-item tax rates and stock.</p></div>
          <div><div className="comp"><img src="/marketing/m-customers.webp" alt="Customer rows with lifetime value and visits."  width={2000} height={462} loading="lazy" decoding="async" /></div>
            <h3>Customers</h3><p>Built from the addresses that actually paid you. Only the address is ever public.</p></div>
        </div>
        <div className="trio rv" style={{ marginTop: "2.75rem" }}>
          <div><div className="comp"><img src="/marketing/m-standout.webp" alt="What stands out panel."  width={644} height={820} loading="lazy" decoding="async" /></div><h3>What stands out</h3><p>The two or three facts worth acting on, written out rather than left in a chart.</p></div>
          <div><div className="comp"><img src="/marketing/m-tax.webp" alt="Tax and refunds panel."  width={644} height={416} loading="lazy" decoding="async" /></div><h3>Tax and refunds</h3><p>VAT by rate over the period, with refunds netted off.</p></div>
          <div><div className="comp"><img src="/marketing/m-assets.webp" alt="Asset mix panel."  width={644} height={416} loading="lazy" decoding="async" /></div><h3>Asset mix</h3><p>What share of the day arrived in which asset, at the rate it settled.</p></div>
        </div>
      </div></section>
      <section className="band" id="who"><div className="sheet">
        <div className="head">
          <p className="mono-label">who it is for</p>
          <h2 className="display-sm">Three people, one app.</h2>
        </div>
        <ul className="who rv">
          <li><em>the counter</em><b>Small shops taking payment</b><span>A café, a market stall, a studio. You want the money and you do not want a third of a percent of every coffee going somewhere else.</span></li>
          <li><em>the holder</em><b>People holding their own keys</b><span>Multi-sig, hardware signing, watch-only accounts and a recovery flow that rehearses itself. The vault never leaves the browser.</span></li>
          <li><em>the accountant</em><b>Whoever does the books</b><span>VAT by rate, per-line tax, refunds netted off, and a transaction hash against every figure. Exports without asking anyone’s permission.</span></li>
        </ul>
      </div></section>
      <section className="band" id="limits"><div className="sheet">
        <div className="head">
          <p className="mono-label">limits<span className="sep">{"//"}</span>stated plainly</p>
          <h2 className="display-sm">What StellarKey will never do.</h2>
          <p className="lede">Each of these was considered and refused, because each one needs a server, and a server is the thing this product will not have. Anything that cannot run on your device is not a feature, it is a promise somebody else has to keep.</p>
        </div>
        <ul className="nope rv">
          <li><span className="x">✕</span><div><b>Host a payment page</b><span>A link a stranger opens has to be served by someone. There is no one.</span></div></li>
          <li><span className="x">✕</span><div><b>Sync two tills</b><span>Shared state needs a shared database. One install is one terminal, and says so.</span></div></li>
          <li><span className="x">✕</span><div><b>Chase an invoice on a timer</b><span>Sending email on a schedule means a machine awake when you are not.</span></div></li>
          <li><span className="x">✕</span><div><b>Pay out to a bank</b><span>That is an anchor’s job, and an anchor is a custodian by another name.</span></div></li>
          <li><span className="x">✕</span><div><b>Reset your password</b><span>Nobody holds a copy. Your recovery phrase is the whole story.</span></div></li>
          <li><span className="x">✕</span><div><b>Know anything about you</b><span>No analytics, no telemetry, no account. The trade is real, and it is the point.</span></div></li>
        </ul>
      </div></section>
      <section className="band" id="faq"><div className="sheet">
        <div className="head">
          <p className="mono-label">the awkward questions</p>
          <h2 className="display-sm">Answered before you ask.</h2>
        </div>
        <div className="faq rv">
          <details><summary>What if the price moves between the code and the payment?</summary>
            <p>The charge is quoted in your currency and converted at the moment it is raised, then held for the life of the request. If the payment arrives outside a tolerance you set, the till says underpaid or overpaid explicitly rather than rounding it away, and the difference is yours to settle, in cash or with a top-up charge.</p></details>
          <details><summary>What if my customer doesn’t have a Stellar wallet?</summary>
            <p>Then they cannot pay this way, and you take cash or a card instead. This is not a replacement for every payment method on day one; it is the one with no StellarKey processing fee when the customer does have a wallet. Be honest with yourself about your own customers before switching anything off.</p></details>
          <details><summary>Where does my money actually go?</summary>
            <p>Straight to the Stellar account you nominate, which you hold the keys to. It never passes through an account we control, because there is no account we control. That is also why there is nobody to freeze it, and nobody to ask if something goes wrong.</p></details>
          <details><summary>What happens if I lose the device?</summary>
            <p>Your funds are on the ledger and recoverable from your recovery phrase on any device. Your <em>records</em>, meaning orders, catalogue and customers, live in that browser’s encrypted storage, so export a backup and keep it somewhere. The app has a guided flow for both, and it will tell you when it thinks you are exposed.</p></details>
          <details><summary>Is this legal for my shop?</summary>
            <p>Taking payment in a digital asset, and how it is taxed, depends entirely on where you trade. The app gives you per-line VAT, VAT by rate over a period, and a transaction hash against every figure, which is what an accountant will ask for. It does not give you advice. Ask someone qualified where you trade.</p></details>
          <details><summary>What does it cost?</summary>
            <p>StellarKey charges no subscription or processing fee. The sender pays Stellar network fees, whose minimum is per operation and can rise during surge pricing. Conversion, spread, reserves, tax, and off-ramp services can add separate costs.</p></details>
        </div>
      </div></section>
      <section className="band" id="start"><div className="sheet">
        <div className="head">
          <p className="mono-label">no signup<span className="sep">{"//"}</span>no custodian<span className="sep">{"//"}</span>first sale today</p>
          <h2 className="display-sm">Start taking payments in minutes.</h2>
          <p className="lede">Create a vault, open the till, and put a code in front of a customer. Nothing to register, nothing to wait for, and nothing about the shop leaves the device it runs on.</p>
          <div className="cta-row">
            <a className="btn btn-gold" href="/app">Open the app</a>
            <a className="btn btn-line" href="#limits">Read the limits first</a>
          </div>
        </div>
        <ol className="steps rv">
          <li><span className="n">01</span><h3>Create a vault</h3><p>A password encrypts a new Stellar key in this browser. Write down the recovery phrase.</p></li>
          <li><span className="n">02</span><h3>Turn on Merchant Mode</h3><p>Name the shop, set your tax rates and tip presets, and choose which assets you accept.</p></li>
          <li><span className="n">03</span><h3>Add it to the home screen</h3><p>It installs as an app from the browser. No store, no review, no waiting.</p></li>
          <li><span className="n">04</span><h3>Take a payment</h3><p>Ring one up and show the code. Watch it settle against the order.</p></li>
        </ol>
      </div></section>

    </>
  );
}
