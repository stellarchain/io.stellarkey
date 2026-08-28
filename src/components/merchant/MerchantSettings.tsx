"use client";

import { useState } from "react";
import {
  useMerchantConfiguration,
  useMerchantRecords,
  useMerchantStaff,
  useMerchantStatus,
} from "@/hooks/useMerchant";
import { useWalletIdentity } from "@/hooks/useWallet";
import { formatTrezorAddress } from "@/lib/address-display";
import { triggerHaptic } from "@/lib/haptics";
import type {
  SettlementSwapIntent,
  SettlementSweepIntent,
} from "@/lib/merchant/settlement";
import type { SettingsSub } from "../SettingsPage";
import { Button, Modal, ModalHeader } from "../ui";
import { useToast } from "../Toast";
import {
  IconFileText,
  IconShield,
  IconSwap,
  IconUsers,
  IconWallet,
} from "../icons";
import {
  IconPercent,
  IconPrinter,
  IconReceipt,
  IconStorefront,
  IconTerminal,
  IconXCircle,
} from "./icons";
import {
  SettingsCaption,
  SettingsRow,
  SettingsSection,
} from "./MerchantSettingsControls";
import {
  MerchantSettingsSheetContent,
  type MerchantSettingsSheet,
} from "./MerchantSettingsSheets";
import { ReceiptSheet } from "./ReceiptSheet";

export function MerchantSettings({
  onDisabled,
  onNavigate,
  onOpenSwap,
  onOpenSend,
}: {
  onDisabled: () => void;
  onNavigate?: (sub: SettingsSub) => void;
  onOpenSwap?: (intent: SettlementSwapIntent) => void;
  onOpenSend?: (intent: SettlementSweepIntent) => void;
}) {
  const { settings, peripherals, settlementRule, settlementHandoffs } =
    useMerchantConfiguration();
  const { orders, charges } = useMerchantRecords();
  const { staff, terminal } = useMerchantStaff();
  const { setEnabled, storageHealth } = useMerchantStatus();
  const { accounts } = useWalletIdentity();
  const { toast } = useToast();
  const [activeSheet, setActiveSheet] = useState<MerchantSettingsSheet | null>(null);
  const [confirmTurnOff, setConfirmTurnOff] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  const [receiptPreviewOpen, setReceiptPreviewOpen] = useState(false);

  const receiptPreviewOrder = orders.find((order) => order.status === "paid") ?? null;
  const receiptPreviewHash = receiptPreviewOrder
    ? charges.find((charge) => charge.orderId === receiptPreviewOrder.id)?.payment?.transactionHash ?? null
    : null;
  const receivingAccount = accounts.find(
    (account) => account.publicKey === settings.receivingPublicKey,
  );
  const staffCount = staff.filter((member) => member.active).length;
  const availablePeripherals = peripherals.filter((item) => item.connected).length;
  const settlementDue =
    settlementHandoffs.swaps.length + (settlementHandoffs.sweep ? 1 : 0);
  const askAt = `${String(settlementRule.sweepPromptHour ?? 21).padStart(2, "0")}:00`;
  const tipsValue =
    settings.tips.mode === "off"
      ? "Off"
      : settings.tips.mode === "percent"
        ? "Percentage"
        : "Fixed";

  function openSheet(sheet: MerchantSettingsSheet) {
    setActiveSheet(sheet);
  }

  async function handleTurnOff() {
    triggerHaptic("warning");
    setTurningOff(true);
    try {
      await setEnabled(false);
      setConfirmTurnOff(false);
      toast("Merchant Mode turned off", "success");
      onDisabled();
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Merchant Mode could not be changed.",
        "error",
      );
    } finally {
      setTurningOff(false);
    }
  }

  return (
    <>
      <div data-merchant-settings-root="true" className="pb-2">
        <h1 className="sr-only">Merchant settings</h1>
        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
          <div data-merchant-settings-column="business" className="space-y-6">
            <SettingsSection title="Business">
              <div className="list-group">
                <SettingsRow
                  first
                  icon={<IconStorefront size={16} />}
                  tint="#30D158"
                  label="Business details"
                  sub="Name, tax ID, address and receipt footer"
                  value={settings.profile.name || "Required"}
                  chevron
                  opensDialog
                  onClick={() => openSheet("business")}
                />
                <SettingsRow
                  icon={<IconReceipt size={16} />}
                  tint="#5E5CE6"
                  label="Latest receipt"
                  sub={
                    receiptPreviewOrder
                      ? "Preview the most recent completed sale"
                      : "Complete a sale to create a preview"
                  }
                  value={receiptPreviewOrder ? `#${receiptPreviewOrder.number}` : "None"}
                  chevron={receiptPreviewOrder !== null}
                  opensDialog={receiptPreviewOrder !== null}
                  onClick={
                    receiptPreviewOrder ? () => setReceiptPreviewOpen(true) : undefined
                  }
                />
              </div>
            </SettingsSection>

            <SettingsSection title="Payments">
              {!settings.receivingPublicKey && (
                <SettingsCaption tone="warn">
                  Choose a receiving account before taking payments.
                </SettingsCaption>
              )}
              <div className="list-group">
                <SettingsRow
                  first
                  icon={<IconWallet size={16} />}
                  tint="#30D158"
                  label="Payment setup"
                  sub={
                    receivingAccount
                      ? formatTrezorAddress(receivingAccount.publicKey)
                      : "Receiving account required"
                  }
                  value={settings.currency}
                  chevron
                  opensDialog
                  onClick={() => openSheet("payments")}
                />
                <SettingsRow
                  icon={<IconWallet size={16} />}
                  tint="#64D2FF"
                  label="Accepted assets"
                  sub="Exact asset and issuer identities"
                  value={`${settings.acceptedAssets.length}`}
                  chevron
                  opensDialog
                  onClick={() => openSheet("assets")}
                />
              </div>
            </SettingsSection>

            <SettingsSection title="Settlement">
              <div className="list-group">
                <SettingsRow
                  first
                  icon={<IconSwap size={16} />}
                  tint="#5E5CE6"
                  label="Settlement rules"
                  sub={`${settlementDue} ${settlementDue === 1 ? "action" : "actions"} due · prompt at ${askAt}`}
                  value={settlementRule.autoConvert ? "Convert & sweep" : "Sweep only"}
                  chevron
                  opensDialog
                  onClick={() => openSheet("settlement")}
                />
              </div>
              <SettingsCaption>
                Rules create reviewed handoffs. Nothing moves without a wallet signature.
              </SettingsCaption>
            </SettingsSection>
          </div>

          <div data-merchant-settings-column="operations" className="space-y-6">
            <SettingsSection title="Checkout">
              <div className="list-group">
                <SettingsRow
                  first
                  icon={<IconPercent size={16} />}
                  tint="#FF9F0A"
                  label="Tax"
                  sub="Calculation mode and keypad default"
                  value={settings.taxMode === "inclusive" ? "Included" : "Added"}
                  chevron
                  opensDialog
                  onClick={() => openSheet("tax")}
                />
                <SettingsRow
                  icon={<IconPercent size={16} />}
                  tint="#BF5AF2"
                  label="Tax rates"
                  sub="Names and percentages"
                  value={`${settings.taxRates.length}`}
                  chevron
                  opensDialog
                  onClick={() => openSheet("rates")}
                />
                <SettingsRow
                  icon={<IconReceipt size={16} />}
                  tint="#BF5AF2"
                  label="Tips"
                  sub="Prompt style and suggested amounts"
                  value={tipsValue}
                  chevron
                  opensDialog
                  onClick={() => openSheet("tips")}
                />
                <SettingsRow
                  icon={<IconFileText size={16} />}
                  tint="#5E5CE6"
                  label="Tax records"
                  sub="Filing periods, exports and adjustments"
                  chevron={Boolean(onNavigate)}
                  onClick={onNavigate ? () => onNavigate("tax") : undefined}
                />
              </div>
            </SettingsSection>

            <SettingsSection title="Operations">
              <div className="list-group">
                <SettingsRow
                  first
                  icon={<IconTerminal size={16} />}
                  tint="#5E5CE6"
                  label="This device"
                  sub={
                    storageHealth?.persistence === "persistent"
                      ? "Persistent encrypted storage"
                      : "Best-effort encrypted storage"
                  }
                  value={settings.terminalName}
                  chevron
                  opensDialog
                  onClick={() => openSheet("device")}
                />
                <SettingsRow
                  icon={<IconUsers size={16} />}
                  tint="#5E5CE6"
                  label="Staff & terminals"
                  sub={`${staffCount} ${staffCount === 1 ? "person" : "people"} · ${terminal.name}`}
                  chevron={Boolean(onNavigate)}
                  onClick={onNavigate ? () => onNavigate("staff") : undefined}
                />
                <SettingsRow
                  icon={<IconPrinter size={16} />}
                  tint="#64D2FF"
                  label="Peripherals"
                  sub="Print, scanner and customer display"
                  value={`${availablePeripherals} available`}
                  chevron={Boolean(onNavigate)}
                  onClick={onNavigate ? () => onNavigate("peripherals") : undefined}
                />
              </div>
            </SettingsSection>

            <SettingsSection title="Merchant Mode">
              <div className="list-group">
                <SettingsRow
                  first
                  danger
                  icon={<IconXCircle size={16} />}
                  tint="#FF453A"
                  label="Turn off Merchant Mode"
                  chevron
                  opensDialog
                  onClick={() => setConfirmTurnOff(true)}
                />
              </div>
              <SettingsCaption>
                Orders, catalogue and settings remain encrypted on this device.
              </SettingsCaption>
            </SettingsSection>
          </div>
        </div>

        <p className="mt-6 flex items-start gap-2 px-1 text-[12px] leading-relaxed text-neutral-500">
          <IconShield size={14} className="mt-[2px] shrink-0 text-[#30D158]" />
          <span>
            Merchant Mode is non-custodial. Payments go straight to your account; refunds are
            ordinary wallet payments that you review and sign.
          </span>
        </p>
      </div>

      <div data-merchant-settings-sheets="true">
        <Modal
          open={activeSheet !== null}
          onClose={() => setActiveSheet(null)}
          wide
        >
          <MerchantSettingsSheetContent
            activeSheet={activeSheet}
            onClose={() => setActiveSheet(null)}
            onNavigate={onNavigate}
            onOpenSwap={onOpenSwap}
            onOpenSend={onOpenSend}
          />
        </Modal>

        <Modal
          open={confirmTurnOff}
          dismissable={!turningOff}
          onClose={() => {
            if (!turningOff) setConfirmTurnOff(false);
          }}
        >
          <ModalHeader
            title="Turn off Merchant Mode?"
            subtitle="The counter disappears, but local records stay intact"
            onClose={turningOff ? undefined : () => setConfirmTurnOff(false)}
          />
          <div className="space-y-4 p-4 sm:p-6">
            <p className="text-[13px] leading-relaxed text-neutral-300">
              Payments still go to the same wallet account. Existing orders, catalogue items,
              reports, and settings remain encrypted on this device.
            </p>
            <Button
              variant="danger"
              className="w-full"
              loading={turningOff}
              onClick={() => void handleTurnOff()}
            >
              Turn Off Merchant Mode
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              disabled={turningOff}
              onClick={() => setConfirmTurnOff(false)}
            >
              Cancel
            </Button>
          </div>
        </Modal>
      </div>

      {receiptPreviewOpen && receiptPreviewOrder && (
        <ReceiptSheet
          open
          onClose={() => setReceiptPreviewOpen(false)}
          order={receiptPreviewOrder}
          transactionHash={receiptPreviewHash}
        />
      )}
    </>
  );
}
