"use client";

import { useState } from "react";

import {
  PUBLISHED_PROCESSOR_RATES,
  annualProcessorFeeMinor,
  annualSales,
  annualTurnoverMinor,
  type PublishedProcessorRate,
} from "@/lib/marketing-fees";

const sterling = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const sterlingWhole = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const integer = new Intl.NumberFormat("en-GB");

function formatMinor(minor: number): string {
  return sterling.format(minor / 100);
}

function formatWholeMinor(minor: number): string {
  return sterlingWhole.format(minor / 100);
}

function formatRate(rate: PublishedProcessorRate): string {
  const percentage = `${rate.rateBps / 100}%`;
  return rate.fixedMinor === 0 ? percentage : `${percentage} + ${formatMinor(rate.fixedMinor)}`;
}

export function FeeCalculator() {
  const [salesPerDay, setSalesPerDay] = useState(40);
  const [ticketMinor, setTicketMinor] = useState(480);

  const salesPerYear = annualSales(salesPerDay);
  const turnoverMinor = annualTurnoverMinor(salesPerDay, ticketMinor);
  const squareFeeMinor = annualProcessorFeeMinor(
    salesPerDay,
    ticketMinor,
    PUBLISHED_PROCESSOR_RATES[0],
  );

  return (
    <div className="calc rv" role="region" aria-label="Annual fee comparison">
      <div className="sliders">
        <div className="slider">
          <label htmlFor="fee-sales">
            <span>Sales a day</span>
            <output aria-hidden="true">{integer.format(salesPerDay)}</output>
          </label>
          <input
            id="fee-sales"
            type="range"
            min="5"
            max="400"
            step="5"
            value={salesPerDay}
            onChange={(event) => setSalesPerDay(Number(event.currentTarget.value))}
          />
        </div>
        <div className="slider">
          <label htmlFor="fee-ticket">
            <span>Average ticket</span>
            <output aria-hidden="true">{formatMinor(ticketMinor)}</output>
          </label>
          <input
            id="fee-ticket"
            type="range"
            min="100"
            max="6000"
            step="20"
            value={ticketMinor}
            onChange={(event) => setTicketMinor(Number(event.currentTarget.value))}
          />
        </div>
        <p className="verdict" aria-live="polite">
          {integer.format(salesPerYear)} sales a year, with {formatWholeMinor(turnoverMinor)} through the till.
        </p>
      </div>

      <div>
        <div className="compare">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Published rate</th>
                <th>Estimated annual fee</th>
              </tr>
            </thead>
            <tbody>
              {PUBLISHED_PROCESSOR_RATES.map((rate) => (
                <tr key={rate.id}>
                  <td>{rate.name}</td>
                  <td>{formatRate(rate)}</td>
                  <td>{formatWholeMinor(annualProcessorFeeMinor(salesPerDay, ticketMinor, rate))}</td>
                </tr>
              ))}
              <tr className="us">
                <td>StellarKey processing fee</td>
                <td>0%</td>
                <td>{formatMinor(0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="verdict">
          At Square&apos;s published rate, this example is <b>{formatWholeMinor(squareFeeMinor)}</b> a year in processing fees. StellarKey&apos;s processing fee is <b>{formatMinor(0)}</b>.
        </p>
      </div>

      <div className="calc-disclosure">
        <p><strong>Illustrative UK assumptions checked 29 August 2026.</strong> Annual totals assume 365 trading days. Provider fees can vary by card, plan, country, and volume.</p>
        <p>StellarKey charges no subscription or processing fee. The sender pays Stellar network fees. Their minimum is per operation and can rise during surge pricing. Conversion, spread, reserves, tax, and off-ramp fees are excluded.</p>
        <p className="calc-sources">
          {PUBLISHED_PROCESSOR_RATES.map((rate) => (
            <a key={rate.id} href={rate.source} target="_blank" rel="noopener noreferrer">
              {rate.name} rate source
            </a>
          ))}
          <a
            href="https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering"
            target="_blank"
            rel="noopener noreferrer"
          >
            Stellar fee documentation
          </a>
        </p>
      </div>
    </div>
  );
}
