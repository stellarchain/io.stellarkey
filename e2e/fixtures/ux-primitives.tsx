'use client';

import { useState } from 'react';
import { Button, CopyButton, Dropdown, Field, HashValue, Modal, ModalHeader, Select, Tabs, Toggle, Tooltip } from '@/components/ui';

// Only opaque synthetic strings. Clipboard behaviour is controlled at the
// browser API boundary by tests; these are the real production primitives.
export function UxPrimitivesFixture() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('public');
  const [automaticTab, setAutomaticTab] = useState('first');
  const [asset, setAsset] = useState('alpha');
  const [empty, setEmpty] = useState(false);
  const [copyValue, setCopyValue] = useState('synthetic-copy-a');
  const [copyMounted, setCopyMounted] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [reordered, setReordered] = useState(false);
  const [gammaState, setGammaState] = useState<'present' | 'removed' | 'disabled'>('present');
  const [fieldError, setFieldError] = useState(true);
  const [switchOn, setSwitchOn] = useState(false);
  const [nestedOpen, setNestedOpen] = useState(false);
  const [tooltipMounted, setTooltipMounted] = useState(true);
  const [tooltipEnabled, setTooltipEnabled] = useState(true);
  const [edgeHelp, setEdgeHelp] = useState(false);
  const [edgeActions, setEdgeActions] = useState(0);
  const options = [
    { value: 'alpha', label: 'Alpha' }, { value: 'beta', label: 'Beta', disabled: true },
    ...(gammaState === 'removed' ? [] : [{ value: 'gamma', label: 'Gamma', disabled: gammaState === 'disabled' }]),
    { value: 'delta', label: 'Delta' },
  ];
  const manualTabProps = { activationMode: 'manual' as const };
  return <>
    <Tooltip label="Synthetic outside guidance"><Button onClick={() => setOpen(true)}>Open UX primitive checks</Button></Tooltip>
    {edgeHelp && <div className="fixed left-1/2 top-2 z-40 -translate-x-1/2">
      <Tooltip label="Synthetic edge guidance">
        <button type="button" aria-label="Show synthetic edge help" className="h-11 w-11 rounded-xl bg-white/10 text-white"
          onClick={() => setEdgeActions(value => value + 1)}>?</button>
      </Tooltip>
      <p data-testid="synthetic-edge-actions" className="sr-only">{edgeActions}</p>
    </div>}
    <Modal open={open} onClose={() => setOpen(false)}>
      <ModalHeader title="Synthetic UX primitives" onClose={() => setOpen(false)} />
      <div className="space-y-5 p-4">
        <Tabs {...manualTabProps} ariaLabel="Synthetic intent tabs" value={tab} onChange={setTab}
          options={[{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }]}>
          <p>{tab === 'public' ? 'Synthetic public panel' : 'Synthetic private panel'}</p>
        </Tabs>
        <Tabs ariaLabel="Synthetic automatic tabs" value={automaticTab} onChange={setAutomaticTab}
          options={[{ value: 'first', label: 'First' }, { value: 'second', label: 'Second' }]}>
          <p>{automaticTab === 'first' ? 'First immediate panel' : 'Second immediate panel'}</p>
        </Tabs>
        <Select ariaLabel="Synthetic asset" value={asset} onChange={setAsset}
          options={empty ? [] : reordered ? [...options.slice(1), options[0]] : options} disabled={disabled} />
        <p data-testid="selected-synthetic-option" className="sr-only">{asset}</p>
        <Button variant="secondary" onClick={() => setEmpty(value => !value)}>Toggle empty options</Button>
        <Button variant="secondary" onClick={() => setDisabled(value => !value)}>Toggle select disabled</Button>
        <Dropdown trigger={(_open, props) => <button {...props} className="chip">Synthetic actions</button>}>
          {close => <>{['One', 'Two', 'Three', 'Four'].map(label =>
            <button key={label} type="button" role="menuitem" className="flex w-full p-3" onClick={close}>{label}</button>,
          )}</>}
        </Dropdown>
        <div data-testid="ordinary-copy">
          {copyMounted ? <CopyButton value={copyValue} label="Copy synthetic item" /> : null}
        </div>
        <Button variant="secondary" onClick={() => setCopyValue(value => value === 'synthetic-copy-a' ? 'synthetic-copy-b' : 'synthetic-copy-a')}>Change synthetic copy value</Button>
        <Button variant="secondary" onClick={() => setCopyMounted(value => !value)}>Toggle synthetic copy control</Button>
        <div data-testid="sensitive-copy"><CopyButton value="synthetic-recovery-placeholder" label="Copy synthetic recovery" sensitive /></div>
        <div data-testid="hash-copy"><HashValue value="syntheticidentifieronly" full /></div>
        <Button variant="secondary" onClick={() => setReordered(value => !value)}>Reorder synthetic options</Button>
        <Button variant="secondary" onClick={() => setGammaState('removed')}>Remove synthetic Gamma</Button>
        <Button variant="secondary" onClick={() => setGammaState('disabled')}>Disable synthetic Gamma</Button>
        {(['md', 'sm'] as const).map(size => <div key={size} data-testid={`select-field-${size}`}>
          <p id={`synthetic-description-${size}`}>Existing synthetic description</p>
          <Field label={`Synthetic ${size} field`} hint="Synthetic selection hint" error={fieldError ? 'Synthetic selection error' : undefined}>
            <Select {...(size === 'sm' ? { id: 'synthetic-existing-select' } : {})}
              aria-describedby={`synthetic-description-${size}`} aria-invalid={false}
              ariaLabel={`Synthetic ${size} field`} size={size} value={asset} onChange={setAsset} options={options} />
          </Field>
        </div>)}
        <Button variant="secondary" onClick={() => setFieldError(value => !value)}>Toggle synthetic field error</Button>
        <div data-testid="named-switch"><Toggle label="Synthetic privacy setting" checked={switchOn} onChange={value => setSwitchOn(Boolean(value))} /></div>
        {tooltipMounted && <div data-testid="tooltip-checks" className="space-y-10">
          <p id="synthetic-tooltip-description">Existing synthetic help description</p>
          {(['top', 'right', 'flipped'] as const).map(placement => <div key={placement}
            className={`flex ${placement === 'top' ? 'justify-center' : placement === 'right' ? 'justify-start' : 'justify-end'}`}>
            <div className="w-11">
              <Tooltip label={tooltipEnabled ? `Synthetic ${placement} guidance` : null} side={placement === 'top' ? 'top' : 'right'}>
                <button type="button" aria-label={`Show synthetic ${placement} help`} aria-describedby="synthetic-tooltip-description"
                  className="h-11 w-11 rounded-xl bg-white/10 text-white">?</button>
              </Tooltip>
            </div>
          </div>)}
        </div>}
        <Button onClick={() => setNestedOpen(true)}>Open nested tooltip check</Button>
        <Button onClick={() => setTooltipEnabled(value => !value)}>Toggle synthetic tooltip labels</Button>
        <Button onClick={() => setTooltipMounted(value => !value)}>Toggle synthetic tooltip controls</Button>
        <Button onClick={() => { setEdgeHelp(true); setOpen(false); }}>Show viewport-edge tooltip</Button>
      </div>
    </Modal>
    <Modal open={nestedOpen} onClose={() => setNestedOpen(false)}>
      <ModalHeader title="Synthetic nested tooltip check" onClose={() => setNestedOpen(false)} />
      <div className="p-10 text-center">
        <Tooltip label="Synthetic nested guidance"><button type="button" className="chip">Show synthetic nested help</button></Tooltip>
      </div>
    </Modal>
  </>;
}
