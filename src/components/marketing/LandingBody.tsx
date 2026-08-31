/*
 * The landing page markup. Static by design: the demo effects live in
 * LandingClient, so this stays a server component.
 *
 * Every product surface is drawn as a panel in the page's own chrome
 * (LandingPanels) rather than screenshotted — crisp at any density, honest
 * about being representative, and weightless next to raster images.
 */
import { STELLAR_MARK_PATH } from "@/components/icons";
import {
  DocAlert, DocBook, DocChip, DocClock, DocCoin, DocCycle, DocExport,
  DocEyeOff, DocFile, DocGlobe, DocKey, DocScales, DocShieldDots,
} from "./DocIcons";
import {
  PanelAddReview, PanelBalance, PanelCharge, PanelDeal, PanelFeed, PanelHours,
  PanelKeypad, PanelMarket, PanelOrders, PanelReceipt, PanelReceive,
  PanelSecurity, PanelSend, PanelSendPrivate, PanelSendReview, PanelStats,
} from "./LandingPanels";

export function LandingBody() {
  return (
    <>

      <section className="sheet">
        <div className="hero-grid">
          <div>
            <p className="mono-label">a stellar wallet<span className="sep">{"//"}</span>a card machine<span className="sep">{"//"}</span>a quiet mode</p>
            <h1 className="display" style={{ marginTop: "1.6rem" }}>Your keys never<br />leave this device.</h1>
            <p className="lede"><strong>StellarKey is three things in one app.</strong> A self-custody Stellar wallet. A point of sale that pays straight into it. And a private balance, in testnet preview, that keeps the amount, the recipient, and the memo to itself.</p>
            <div className="cta-row">
              <a className="btn btn-gold" href="/app">Open the app</a>
              <a className="btn btn-line" href="#till">See the till</a>
              <a className="btn btn-line" href="#private">Then go quiet</a>
            </div>
            <p className="hero-foot">Horizon or RPC for the chain · this device for everything else</p>
          </div>

          <div className="hero-stack rv">
            <div className="stack-back back-l" aria-hidden="true"><PanelFeed /></div>
            <div className="stack-back back-r" aria-hidden="true"><PanelCharge /></div>
            <div className="stack-front">
          <div className="demo" id="sign" data-demo="sign">
            <div className="bar"><span className="dot" data-dot></span><b data-label>signing a payment</b>
              <button className="replay" data-replay type="button">Replay</button></div>
            <div className="stage" style={{ height: "21rem" }}>
              <div className="step" data-step="0">
                <div className="sub" style={{ marginBottom: ".7rem" }}>VAULT · LOCKED</div>
                <div className="rows">
                  <div><span>encryption</span><b>AES-256-GCM · PBKDF2</b></div>
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
          </div>
        </div>
      </section>

      <section className="band"><div className="sheet" style={{ paddingTop: "3rem", paddingBottom: "3rem" }}>
        <ul className="rail">
          <li><b>AES-256-GCM</b><span>The vault cipher, keyed by PBKDF2, encrypted here, never uploaded.</span></li>
          <li><b>0</b><span>Accounts, servers or custodians between you and your money.</span></li>
          <li><b>1</b><span>Network dependency. Horizon or RPC, Stellar’s public APIs.</span></li>
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
          <div className="panel-grid fill">
            <PanelBalance />
            <PanelMarket />
            <PanelSecurity />
          </div>
          <p className="cap-line">the balance, the market, and a security posture the wallet scores itself</p>
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
              <li>A security score that shows the gap before it matters</li>
            </ul>
          </div>
          <PanelSend />
        </div>
      </div></section>
      <section className="band" id="till-intro"><div className="sheet" style={{ paddingTop: "6rem", paddingBottom: "1.5rem" }}>
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
                <div><span>payment route</span><b className="g">in the address</b></div>
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
                <div><span>matched by</span><b>payment route</b></div>
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
          <li><span className="n">03 / charge</span><h3>Show the code</h3><p>A SEP-7 request carrying a muxed Stellar address and the amount. The payment route is embedded in the address, so no memo is required.</p></li>
          <li><span className="n">04 / settle</span><h3>It files itself</h3><p>The till marks the order paid when the network payment is reported and matched.</p></li>
        </ol>

        <div className="row rv">
          <div>
            <p className="mono-label">you can check it<span className="sep">{"//"}</span>without trusting us</p>
            <h3>Every sale leaves a public receipt</h3>
            <p>This is the receipt StellarKey produces after a payment is matched. Order, exact asset amount, payer, transaction hash and ledger, together on one sheet, checkable by anyone you show it to.</p>
            <p className="cap-line">representative testnet receipt · values are illustrative</p>
          </div>
          <div className="verify" style={{ marginTop: 0 }}>
            <table><tbody>
              <tr><td>order</td><td>#1024 · MC-O-1024</td></tr>
              <tr><td>total</td><td>€ 4.80 · VAT 23 % included</td></tr>
              <tr><td>received</td><td className="j">22.3755101 XLM</td></tr>
              <tr><td>payer</td><td>GC33 RABA … Z03U 7604</td></tr>
              <tr><td>transaction</td><td className="g">ef3a 5dd7 … 016a b94f</td></tr>
              <tr><td>ledger</td><td>4,369,215</td></tr>
            </tbody></table>
          </div>
        </div>

        <div className="row flip rv">
          <div>
            <p className="mono-label">the counter</p>
            <h3>A till, not a checkout page</h3>
            <p>The ticket builds on the right while the keypad or the catalogue fills it. Staff are roles on this device, gated by a PIN, and every action is attributed to whoever is on shift.</p>
            <ul className="ticks">
              <li>Owner, manager, server, accountant, each with its own rights</li>
              <li>Refund ceilings per role, and anything above becomes a request</li>
              <li>Five wrong PINs and the till pauses for thirty seconds</li>
            </ul>
          </div>
          <PanelKeypad />
        </div>
        <div className="row rv">
          <div>
            <p className="mono-label">one qr<span className="sep">{"//"}</span>one payment route</p>
            <h3>The address carries the reconciliation</h3>
            <p>Each request has an immutable numeric route. Standard embeds it in a muxed Stellar address; Trezor uses the same route as a MEMO_ID with the classic shop address. StellarKey matches either form from the public ledger, on device.</p>
            <ul className="ticks">
              <li>Underpaid and overpaid handled explicitly, not silently</li>
              <li>Anything unmatched lands in a tray instead of disappearing</li>
              <li>Charges keep running while the till serves the next customer</li>
            </ul>
          </div>
          <PanelCharge />
        </div>
        <div className="row flip rv">
          <div>
            <p className="mono-label">proof</p>
            <h3>A receipt that is also an audit trail</h3>
            <p>Lines, VAT by rate, the payer’s address, the transaction hash, how it was matched and the ledger it closed in, all on one sheet, ready for whoever asks.</p>
          </div>
          <PanelReceipt />
        </div>
      </div></section>
      <section className="band" id="till"><div className="sheet">
        <div className="head">
          <p className="mono-label">records<span className="sep">{"//"}</span>computed locally<span className="sep">{"//"}</span>sent nowhere</p>
          <h2 className="display-sm">And keeps the books where you can reach them.</h2>
        </div>
        <div className="band-strip rv"><PanelStats /></div>
        <p className="cap-line">the same strip opens orders, invoices, customers and insights</p>
        <div className="row rv">
          <div>
            <p className="mono-label">the records</p>
            <h3>Orders, catalogue, customers — kept here</h3>
            <p>Every record the till produces lives in this device’s encrypted storage, and each figure carries the payment that made it.</p>
            <ul className="ticks">
              <li>Every sale with its payment, its ledger and its route</li>
              <li>A catalogue with per-item tax rates and stock</li>
              <li>Customers built from the addresses that actually paid you</li>
              <li>CSV exports that state their own row counts</li>
            </ul>
          </div>
          <PanelOrders />
        </div>
        <div className="row flip rv">
          <div>
            <p className="mono-label">the insights</p>
            <h3>It tells you what stands out</h3>
            <p>Tuesday is your quietest day. The 13:00 hour pays the rent. The facts worth acting on, written out rather than left in a chart.</p>
            <ul className="ticks">
              <li>Today against what this weekday normally does</li>
              <li>VAT by rate over the period, refunds netted off</li>
              <li>The asset mix, at the rate each sale settled</li>
            </ul>
          </div>
          <PanelHours />
        </div>
      </div></section>
      <section className="band" id="till-kit"><div className="sheet">
        <div className="head">
          <p className="mono-label">the rest of the till<span className="sep">{"//"}</span>same device<span className="sep">{"//"}</span>no server</p>
          <h2 className="display-sm">A counter’s worth of tools, none of them hosted.</h2>
          <p className="lede">Everything a card machine’s dashboard promises, done locally instead. Each of these lives in the till’s encrypted records, and none of it phones home.</p>
        </div>
        <ul className="facts rv">
          <li><span className="d"><DocFile /></span><div><b>Invoices</b><span>Drafted, issued, and reconciled from the ledger like any sale. Overdue is a fact the app shows you, not an email it sends.</span></div></li>
          <li><span className="d"><DocBook /></span><div><b>Counter codes</b><span>A printable poster that lives by the till. Fixed or open amounts, per-code assets, and a QR sized to scan from a customer’s reach.</span></div></li>
          <li><span className="d"><DocCycle /></span><div><b>Customer display</b><span>This device, turned around. The total flips 180°, the staff controls dim, and a PIN guards the way back.</span></div></li>
          <li><span className="d"><DocClock /></span><div><b>Shifts</b><span>An opening float, tenders by kind, expected cash against counted cash, and the variance in writing at close.</span></div></li>
          <li><span className="d"><DocCoin /></span><div><b>Tips before the code</b><span>The tip question comes before the QR, with no tip given equal weight. Nothing is added quietly after.</span></div></li>
          <li><span className="d"><DocScales /></span><div><b>Per-line VAT</b><span>Every line carries its own rate, so the period report is arithmetic, not archaeology.</span></div></li>
          <li><span className="d"><DocExport /></span><div><b>Exports</b><span>CSV reports that state their own row counts, and an encrypted archive for everything else.</span></div></li>
          <li><span className="d"><DocChip /></span><div><b>Peripherals, honestly</b><span>A barcode scanner that is just a keyboard, a cash drawer on the printer’s kick pulse. No pairing ceremony.</span></div></li>
        </ul>
      </div></section>

      <section className="band" id="private"><div className="sheet" style={{ paddingTop: "6rem", paddingBottom: "1.5rem" }}>
        <div className="hero-grid">
          <div className="head">
            <p className="mono-label">act three<span className="sep">{"//"}</span>the same wallet, in private</p>
            <h2 className="display-sm">Then it goes quiet.</h2>
            <p className="lede"><strong>Private Payments is the same wallet with a second pocket.</strong> Move XLM or USDC into a private balance and send it where the amount, the recipient, and the memo stay encrypted. The proof is built on this device; a contract on the public Stellar ledger verifies it without reading it.</p>
            <p className="lede">It ships today as a preview on Stellar testnet, and it is honest about its edges. Money moving in or out of the private balance is public by design. Network fees are paid by your Stellar account, and timing is public. Privacy grows with more independent activity — it is context, not a guarantee.</p>
          </div>
          <div className="rv"><PanelDeal /></div>
        </div>
      </div></section>

      <section className="band" id="private-how"><div className="sheet">
        <div className="head">
          <p className="mono-label">a private payment<span className="sep">{"//"}</span>proved here<span className="sep">{"//"}</span>verified there</p>
          <h2 className="display-sm">Payments that keep the amount to themselves.</h2>
          <p className="lede">There is no relayer, no indexer, and no key service under this. The wallet downloads hash-pinned proving files once, builds each proof in an isolated worker, and talks straight to the Stellar RPC endpoint you chose. This is the whole journey.</p>
        </div>
        <div className="demo inline rv" data-demo="quiet">
          <div className="bar"><span className="dot" data-dot></span><b data-label>a private payment, start to finish</b>
            <button className="replay" data-replay type="button">Replay</button></div>
          <div className="stage">
            <div className="step" data-step="0">
              <div className="sub" style={{ marginBottom: ".7rem" }}>ADD · PUBLIC → PRIVATE</div>
              <div className="rows">
                <div><span>moving</span><b>public → private</b></div>
                <div><span>amount</span><b className="g">+100 XLM</b></div>
                <div><span>from</span><b>GCSB 52KD … H3XD</b></div>
                <div><span>network fee</span><b>0.4271827 XLM</b></div>
              </div>
              <div className="wait"><span className="dot live"></span>this entry is public by design</div>
            </div>
            <div className="step" data-step="1">
              <div className="sub" style={{ marginBottom: ".7rem" }}>PROVE · ON THIS DEVICE</div>
              <div className="rows">
                <div><span>circuit</span><b>56,757 constraints</b></div>
                <div><span>built in</span><b>an isolated worker</b></div>
                <div><span>uploaded</span><b className="g">nothing</b></div>
              </div>
              <div className="pinrow" data-prove><i></i><i></i><i></i><i></i><i></i><i></i></div>
              <div className="sub" style={{ textAlign: "center", marginTop: ".7rem" }}>proving…</div>
            </div>
            <div className="step" data-step="2">
              <div className="sub" style={{ marginBottom: ".7rem" }}>REVIEW · PRIVATE SEND</div>
              <div className="rows">
                <div><span>amount</span><b className="g">encrypted</b></div>
                <div><span>recipient</span><b className="g">encrypted · FC42 C9CF</b></div>
                <div><span>memo</span><b className="g">encrypted</b></div>
                <div><span>network fee</span><b>0.4847157 XLM · public</b></div>
              </div>
              <div className="wait">the review shows you everything · the ledger sees none of it</div>
            </div>
            <div className="step" data-step="3">
              <div className="sub" style={{ marginBottom: ".7rem" }}>WHAT AN OBSERVER SEES</div>
              <div className="rows">
                <div><span>a contract interaction</span><b>visible</b></div>
                <div><span>the fee account</span><b>visible</b></div>
                <div><span>timing</span><b>visible</b></div>
                <div><span>amount · recipient · memo</span><b className="g">encrypted</b></div>
              </div>
              <div className="wait" style={{ marginTop: ".9rem" }}>and nothing else</div>
            </div>
          </div>
          <div className="track" data-track><i></i><i></i><i></i><i></i></div>
        </div>

        <div className="head" style={{ marginTop: "4.5rem" }}>
          <p className="mono-label">the split<span className="sep">{"//"}</span>drawn exactly</p>
          <h2 className="display-sm">What leaves your device.</h2>
          <p className="lede">Everything on the left stays in this browser’s encrypted storage. Everything on the right is public on Stellar, for anyone, forever. The only thing that crosses is the proof.</p>
        </div>
        <div className="split rv">
          <svg
            viewBox="0 0 760 432"
            role="img"
            aria-label="Split diagram. Stays on this device: your keys, amounts, recipients, memos, the proof’s inputs. The public ledger: deposits and withdrawals with their amounts, network fees paid by your Stellar account, timing, and an encrypted package. One arrow crosses between them: the proof, checkable by the contract, readable by no one."
            style={{ fontFamily: "var(--mono)" }}
          >
            <rect x="8" y="14" width="334" height="322" rx="10" fill="#0E0E11" stroke="rgba(255,255,255,0.13)" />
            <rect x="418" y="14" width="334" height="322" rx="10" fill="#0E0E11" stroke="rgba(255,255,255,0.13)" />
            <text x="36" y="54" fill="#FDDA24" fontSize="12" letterSpacing="2">STAYS ON THIS DEVICE</text>
            <text x="446" y="54" fill="#B3B3B3" fontSize="12" letterSpacing="2">THE PUBLIC LEDGER</text>
            <g fill="#AA840E">
              <rect x="38" y="86" width="5" height="5" transform="rotate(45 40.5 88.5)" />
              <rect x="38" y="126" width="5" height="5" transform="rotate(45 40.5 128.5)" />
              <rect x="38" y="166" width="5" height="5" transform="rotate(45 40.5 168.5)" />
              <rect x="38" y="206" width="5" height="5" transform="rotate(45 40.5 208.5)" />
              <rect x="38" y="246" width="5" height="5" transform="rotate(45 40.5 248.5)" />
              <rect x="448" y="86" width="5" height="5" transform="rotate(45 450.5 88.5)" />
              <rect x="448" y="144" width="5" height="5" transform="rotate(45 450.5 146.5)" />
              <rect x="448" y="202" width="5" height="5" transform="rotate(45 450.5 204.5)" />
              <rect x="448" y="240" width="5" height="5" transform="rotate(45 450.5 242.5)" />
            </g>
            <g fill="#D9D9DE" fontSize="14">
              <text x="56" y="94">your keys</text>
              <text x="56" y="134">amounts</text>
              <text x="56" y="174">recipients</text>
              <text x="56" y="214">memos</text>
              <text x="56" y="254">the proof’s inputs</text>
              <text x="466" y="94">deposits and withdrawals,</text>
              <text x="466" y="112">with their amounts</text>
              <text x="466" y="152">network fees, paid by</text>
              <text x="466" y="170">your Stellar account</text>
              <text x="466" y="210">timing</text>
              <text x="466" y="248">an encrypted package</text>
            </g>
            <text x="36" y="312" fill="#8C8C8C" fontSize="11">encrypted at rest · never uploaded</text>
            <text x="446" y="312" fill="#8C8C8C" fontSize="11">visible to anyone, forever</text>
            <path d="M175 336 L175 384 L585 384 L585 344" fill="none" stroke="#FDDA24" strokeWidth="1.5" />
            <polygon points="579,350 591,350 585,338" fill="#FDDA24" />
            <text x="380" y="372" textAnchor="middle" fill="#FDDA24" fontSize="13">the proof</text>
            <text x="380" y="414" textAnchor="middle" fill="#8C8C8C" fontSize="11.5">checkable by the contract · readable by no one</text>
          </svg>
        </div>

        <div className="head" style={{ marginTop: "4.5rem" }}>
          <p className="mono-label">the surfaces<span className="sep">{"//"}</span>same geometry<span className="sep">{"//"}</span>representative values</p>
          <h2 className="display-sm">This is what quiet looks like.</h2>
          <p className="lede">The surfaces below are drawn in this page’s own ink — the same layout, the same marks, the same honesty as the app’s screens, with representative values. The real thing runs on testnet today, one click away.</p>
        </div>
        <div className="row rv">
          <div>
            <p className="mono-label">crossing in public</p>
            <h3>Adding funds is public. The result is not.</h3>
            <p>Moving money into the private balance is an ordinary Stellar transaction, and the review says so in plain words before you confirm. What you hold afterwards is nobody’s business but yours.</p>
            <ul className="ticks">
              <li>The exact network fee, shown before anything is signed</li>
              <li>A balance-after table: 0, plus 100, equals 100</li>
              <li>The same honesty on the way out, like any public payment</li>
            </ul>
          </div>
          <PanelAddReview />
        </div>
        <div className="row flip rv">
          <div>
            <p className="mono-label">receiving<span className="sep">{"//"}</span>no registry</p>
            <h3>An address that lives nowhere on chain</h3>
            <p>A shielded address is shared out-of-band, as a QR or a copy, and never registered anywhere. The short verification code under it lets the sender check they have the right one before any money moves.</p>
          </div>
          <PanelReceive />
        </div>
        <div className="plate rv">
          <div className="panel-grid center">
            <PanelSendPrivate />
            <PanelSendReview />
          </div>
        </div>
        <p className="cap-line">the send and its review · the fee is public and says so · the rest is encrypted</p>
        <div className="row rv">
          <div>
            <p className="mono-label">the shield notch</p>
            <h3>One feed, wearing its provenance</h3>
            <p>Private and public activity share one list. The private rows wear a small Stellar shield on the direction circle; the public row beside them does not. That is the whole disclosure policy — visible, per row, in the feed you already read.</p>
          </div>
          <PanelFeed />
        </div>

        <div className="head" style={{ marginTop: "4.5rem" }}>
          <p className="mono-label">one glyph<span className="sep">{"//"}</span>three containers</p>
          <h2 className="display-sm">One mark, three duties.</h2>
          <p className="lede">The official Stellar symbol, unmodified and at its native line weight, set in a lock for the wallet you own, a shield for the payments you keep quiet, and a receipt for the sales you can prove.</p>
        </div>
        <div className="marks rv">
          <div>
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <g fill="none" stroke="currentColor" transform="translate(1.486 9.343) scale(0.9535)">
                <path d="M20.17 13.832V6.227a11.83 11.83 0 0 1 23.66 0V13.832" strokeWidth="2.4" strokeLinecap="butt" strokeLinejoin="round" fill="none" />
                <circle cx="32" cy="32" r="21.125" strokeWidth="2.4" fill="none" />
                <path transform="translate(17.6 17.6) scale(1.2)" d={STELLAR_MARK_PATH} fill="currentColor" stroke="none" />
              </g>
            </svg>
            <b>the lock</b>
            <span>the wallet you own</span>
          </div>
          <div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path transform="translate(6.24 4.98) scale(0.48)" d={STELLAR_MARK_PATH} fill="currentColor" stroke="none" />
            </svg>
            <b>the shield</b>
            <span>the payments you keep private</span>
          </div>
          <div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 20.5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v15.5L16.7 21.4 14.4 20.5 12 21.4 9.6 20.5 7.3 21.4Z" />
              <path transform="translate(7.44 6.63) scale(0.38)" d={STELLAR_MARK_PATH} fill="currentColor" stroke="none" />
            </svg>
            <b>the till receipt</b>
            <span>the sales you can prove</span>
          </div>
        </div>

        <div className="head" style={{ marginTop: "4.5rem" }}>
          <p className="mono-label">honest edges<span className="sep">{"//"}</span>no small print</p>
          <h2 className="display-sm">The quiet part, said out loud.</h2>
        </div>
        <ul className="facts rv">
          <li><span className="d"><DocGlobe /></span><div><b>Deposits and withdrawals are public</b><span>Crossing between pockets shows its amount, its account and its timing on Stellar, like any public payment.</span></div></li>
          <li><span className="d"><DocCoin /></span><div><b>The fee account is public</b><span>A private send is still a transaction, and the Stellar account paying its fee is visible, along with when.</span></div></li>
          <li><span className="d"><DocShieldDots /></span><div><b>Privacy is context, not a guarantee</b><span>It grows with more independent activity, and it can shrink with reuse and timing.</span></div></li>
          <li><span className="d"><DocAlert /></span><div><b>A preview on testnet today</b><span>Mainnet waits for independent audit and trusted-setup evidence. The app shows you that status table itself.</span></div></li>
          <li><span className="d"><DocKey /></span><div><b>Recovery is your phrase alone</b><span>The private balance rebuilds from the public record, on this device, with no server to ask. Restoring can cost network fees.</span></div></li>
          <li><span className="d"><DocEyeOff /></span><div><b>Testnet balances are worth nothing</b><span>Values shown against private testnet assets are representative pricing only.</span></div></li>
        </ul>
        <div className="cta-row">
          <a className="btn btn-line" href="/private">Read exactly how it works →</a>
        </div>
      </div></section>
      <section className="band" id="who"><div className="sheet">
        <div className="head">
          <p className="mono-label">who it is for</p>
          <h2 className="display-sm">Three people, one app.</h2>
        </div>
        <ul className="who rv">
          <li><em>the counter</em><b>Small shops taking payment</b><span>A café, a market stall, a studio. You want the money and you do not want a third of a percent of every coffee going somewhere else.</span></li>
          <li><em>the holder</em><b>People holding their own keys</b><span>Multi-sig, hardware signing, watch-only accounts, and a private balance in testnet preview for the payments that are nobody else’s business. The vault never leaves the browser.</span></li>
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
          <details><summary>Why can everyone see me adding money to a private balance?</summary>
            <p>Because crossing between pockets is a public Stellar transaction, and pretending otherwise would be a lie. Adding funds is public; the resulting private balance is not. Inside, the amount, the recipient, and the memo of a send stay encrypted. Step back out and the withdrawal is public again, like any Stellar payment.</p></details>
          <details id="cost"><summary>What does it cost?</summary>
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
