import { config } from 'dotenv';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

config();

const client = new SuiClient({ url: getFullnodeUrl('testnet') });
const keypair = Ed25519Keypair.deriveKeypair(process.env.SUI_PRIVATE_KEY!);

async function main() {
  const tx = new Transaction();
  const packageId = process.env.PROXY_PACKAGE_ID!;
  const typeArgs = [
    '0x2::sui::SUI',
    '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC',
  ];
  tx.moveCall({
    target: `${packageId}::risk_proxy::place_limit_order`,
    typeArguments: typeArgs,
    arguments: [
      tx.object(process.env.PROXY_CONTRACT_ID!),
      tx.object(process.env.DEEPBOOK_POOL_ADDRESS!),
      tx.object(process.env.BALANCE_MANAGER_ID!),
      tx.pure.u64(Date.now() + 1000), // client_order_id
      tx.pure.u8(0), // order_type
      tx.pure.u8(0), // self_matching
      tx.pure.u64(0.5 * 1e9), // price
      tx.pure.u64(1 * 1e9), // quantity
      tx.pure.bool(true), // is_bid
      tx.pure.bool(false), // pay_with_deep
      tx.pure.u64(Date.now() + 60000), // expire_timestamp
      tx.object('0x6'), // clock
    ],
  });

  const response = await client.devInspectTransactionBlock({
    sender: keypair.toSuiAddress(),
    transactionBlock: tx,
  });
  console.log(JSON.stringify(response.error, null, 2));
}

main().catch(console.error);
