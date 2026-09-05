'use client';

import { useState } from 'react';
import { Button, CopyButton, Dropdown, HashValue, Modal, ModalHeader, Select, Tabs } from '@/components/ui';

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
  const options = [
    { value: 'alpha', label: 'Alpha' }, { value: 'beta', label: 'Beta', disabled: true },
    ...(gammaState === 'removed' ? [] : [{ value: 'gamma', label: 'Gamma', disabled: gammaState === 'disabled' }]),
    { value: 'delta', label: 'Delta' },
  ];
  const manualTabProps = { activationMode: 'manual' as const };
  return <>
    <Button onClick={() => setOpen(true)}>Open UX primitive checks</Button>
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
      </div>
    </Modal>
  </>;
}
