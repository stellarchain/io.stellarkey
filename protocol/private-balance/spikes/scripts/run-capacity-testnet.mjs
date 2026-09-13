// TESTNET ONLY. Non-browser, isolated random synthetic keys; no persisted wallet,
// XDR, proofs, inputs, note contents, account addresses or transaction hashes.
import { Keypair, StrKey, TransactionBuilder, rpc } from '@stellar/stellar-sdk';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import * as p from '@stellarkey/private-balance';
import { groth16 } from 'snarkjs';
import { preparePrivateAction } from '../../../../src/features/private-balance/worker/action-builder.ts';
import { PrivateBalanceTransactionBuilder } from '../../../../src/features/private-balance/runtime/transaction-builder.ts';
import { PrivateBalanceArchiveClient } from '../../../../src/features/private-balance/runtime/archive-client.ts';
import { scanArchiveRecords } from '../../../../src/features/private-balance/runtime/scanner.ts';
if (!process.argv.includes('--testnet-synthetic')) throw new Error('Pass --testnet-synthetic to fund and submit isolated Testnet actions.');
const m=JSON.parse(readFileSync('public/protocol/private-balance/v1/manifest.json'));
if(m.networkPassphrase!=='Test SDF Network ; September 2015'||m.protocolVersion!==2)throw Error('Testnet V2 only');
const url='https://soroban-testnet.stellar.org';const server=new rpc.Server(url);const archive=new PrivateBalanceArchiveClient(url,m);
const funding=Keypair.random();const seed=new Uint8Array(randomBytes(64));let esk;let stage='funding';
const evidence={observedAt:new Date().toISOString(),poolContractId:m.poolContractId,wasmSha256:m.release.contractWasmSha256,r1csSha256:m.artifacts.r1csSha256,scope:'Isolated synthetic Testnet XLM deposit, self-transfer and full-input exit through actual Wasm; no browser UI or USDC claim.',actions:[],passed:false};
try{
 const funded=await fetch('https://friendbot.stellar.org?addr='+funding.publicKey(),{signal:AbortSignal.timeout(30000)});if(!funded.ok)throw Error('funding');await funded.arrayBuffer();
 const base={protocolVersion:2,networkId:Buffer.from(m.networkId,'hex'),realmId:Buffer.from(m.realmId,'hex'),poolId:new Uint8Array(StrKey.decodeContract(m.poolContractId)),deploymentBindingHash:Buffer.from(m.deploymentBindingHash,'hex'),addressPrefix:'tskpay_',assets:m.assets};
 const accountPublicKey=new Uint8Array(funding.rawPublicKey());const contextHash=p.computeContextHash(2,base.networkId,base.realmId,base.poolId);const contextField=p.computeContextField(contextHash);
 esk=await p.deriveExpandedSpendingKey(seed,2,base.networkId,base.realmId,base.poolId,accountPublicKey,contextField);
 const keyContext={...base,accountPublicKey,contextField};const diversifier=new Uint8Array([0,0,0,1]);const identity=await p.deriveDiversifiedAddressKeys(esk.baseOwnerCommitment,esk.hpkePrivateKey,diversifier);
 const recipientAddress=p.encodePrivateAddress({deploymentTag:p.derivePrivateAddressDeploymentTag(base.deploymentBindingHash),diversifier,ownerCommitment:identity.ownerCommitment,hpkePublicKey:identity.hpkePublicKey},'tskpay_');
 const scan=async()=>{const head=await archive.readHead();if(head.meta.actionCount>30n)throw Error('history bound');const records=head.meta.actionCount===0n?[]:await archive.readRecords(0n,Number(head.meta.actionCount));const scanned=await scanArchiveRecords({records,viewingKey:p.toViewingKey(esk),context:{...base,contextHash,contextField,accountAddress:{kind:0,payload:accountPublicKey}},expectedPriorRecordHash:p.computeGenesisRecordHash(contextHash,base.deploymentBindingHash)});if(!Buffer.from(scanned.tree.currentRoot).equals(Buffer.from(head.tree.currentRoot)))throw Error('head mismatch');const nodes=await p.MerkleNodeStore.fromCommitments(records.filter(r=>r.actionKind!==4).flatMap(r=>r.outputs.map(o=>o.cm)));return {head,scanned,nodes};};
 stage='initial_public_head';const initial=await scan();let current=initial;
 for(const kind of ['deposit','transfer','withdraw']){
  stage=kind;const availableNotes=current.scanned.notes.filter(n=>n.status==='unspent');const selectedNoteIds=availableNotes.map(n=>n.id);
  const intent=kind==='deposit'?{kind,assetIndex:0,assetContractId:m.assets[0].contractId,publicValue:'1',depositSource:{kind:0,payload:accountPublicKey}}:kind==='transfer'?{kind,assetIndex:0,assetContractId:m.assets[0].contractId,amount:'1',recipientAddress,selectedNoteIds,anchorRoot:current.head.tree.currentRoot,anchorExpiresAtLedger:current.head.latestLedger+1000}:{kind,assetIndex:0,assetContractId:m.assets[0].contractId,publicValue:'1',publicRecipient:{kind:0,payload:accountPublicKey},selectedNoteIds,anchorRoot:current.head.tree.currentRoot,anchorExpiresAtLedger:current.head.latestLedger+1000};
  const built=await preparePrivateAction({esk,keyContext,availableNotes,merklePaths:await Promise.all(availableNotes.map(n=>current.nodes.getPath(n.leafIndex))),intent});
  const proved=await groth16.fullProve(built.circuitInputs,'public/protocol/private-balance/v1/circuit.wasm','public/protocol/private-balance/v1/circuit.zkey',undefined,undefined,{singleThread:true});
  if(!await groth16.verify(JSON.parse(readFileSync('public/protocol/private-balance/v1/verification-key.json')),proved.publicSignals,proved.proof))throw Error('proof invalid');
  const bytes=p.encodeProofForSoroban(proved.proof);const proof={a:bytes.slice(0,64),b:bytes.slice(64,192),c:bytes.slice(192)};const a=built.action;const action={actionNonce:a.actionNonce,anchorRoot:a.anchorRoot,nullifiers:a.nullifiers,outputs:a.outputs.map(o=>({commitment:o.cm,recipientEnvelope:o.recipientEnvelope,outgoingEnvelope:o.outgoingEnvelope})),publicValue:a.publicValue};
  const builder=new PrivateBalanceTransactionBuilder(m);const operation=kind==='deposit'?builder.buildDepositOperation({action:{...action,assetIndex:0,depositSource:funding.publicKey()},proof}):kind==='transfer'?builder.buildTransferOperation({action,proof}):builder.buildFullInputExitOperation({action:{...action,assetIndex:0,publicRecipient:funding.publicKey()},proof});
  if(kind==='withdraw'&&a.kind!==4)throw Error('wrong exit mode');
  const raw=new TransactionBuilder(await server.getAccount(funding.publicKey()),{networkPassphrase:m.networkPassphrase,fee:'100'}).addOperation(operation).setTimeout(180).build();const simulation=await server.simulateTransaction(raw);
  if(!rpc.Api.isSimulationSuccess(simulation)||BigInt(simulation.minResourceFee)>10000000n)throw Error('simulation or fee');
  const tx=rpc.assembleTransaction(raw,simulation).build();tx.sign(funding);const reply=await server.sendTransaction(tx);if(!['PENDING','DUPLICATE'].includes(reply.status))throw Error('submission rejected');
  let confirmed;const deadline=Date.now()+90000;while(Date.now()<deadline){const result=await server.getTransaction(reply.hash);if(result.status==='SUCCESS'){confirmed=result;break;}if(result.status==='FAILED')throw Error('ledger failed');await new Promise(r=>setTimeout(r,1000));}if(!confirmed)throw Error('status unknown');
  const next=await scan();if(next.head.meta.actionCount!==current.head.meta.actionCount+1n)throw Error('action advance');const expected=kind==='withdraw'?current.head.tree.nextIndex:current.head.tree.nextIndex+3n;if(next.head.tree.nextIndex!==expected)throw Error('leaf advance');if(kind==='withdraw'&&!Buffer.from(next.head.tree.currentRoot).equals(Buffer.from(current.head.tree.currentRoot)))throw Error('exit root changed');
  evidence.actions.push({method:kind==='withdraw'?'full_input_exit':kind,ledger:confirmed.ledger,minimumResourceFeeStroops:simulation.minResourceFee,confirmed:true,archiveAdvance:1,leafAdvance:kind==='withdraw'?0:3});console.log('Synthetic '+kind+' confirmed and canonical replay checked.');current=next;
 }
 if(current.scanned.notes.some(n=>n.status==='unspent'))throw Error('unspent synthetic note remains');evidence.freshSeedScanSpent=true;evidence.passed=true;
}catch(error){evidence.failureStage=stage;console.log('Synthetic lifecycle stopped at '+stage+'; no confirmation is inferred.');process.exitCode=1;}
finally{seed.fill(0);if(esk)for(const value of Object.values(esk))if(value instanceof Uint8Array)value.fill(0);writeFileSync('protocol/private-balance/results/capacity-testnet-lifecycle.json',JSON.stringify(evidence,null,2)+'\n');}
process.exit(process.exitCode??0);
