import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', 'data', 'app.db');

async function main() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  const rows = await db.all("SELECT key, value FROM app_settings WHERE key LIKE 'pharmarack_%'");
  const settings = {};
  rows.forEach(r => {
    settings[r.key] = r.value;
  });
  await db.close();

  const token = settings['pharmarack_session_token'];
  if (!token) {
    console.error('No Pharmarack session token found!');
    return;
  }

  // Build the complete lineItem payload with all properties
  const payload = {
    StoreId: 109,
    StoreName: "Kundan Distributors P Ltd -(Sadashivpeth -Counter)",
    ProductCode: "8587",
    Quantity: 1,
    PTR: 39.25,
    Free: 0,
    HiddenPTR: 39.25,
    NetRate: 39.25,
    Scheme: "",
    SchemeType: "",
    GSTPercentage: 5,
    ItemGSTValue: 0,
    CartSource: "MOVP",
    DeliveryOption: "",
    RemarkForStore: "",
    ProductAddedBy: 0,
    Priority: "",
    OrderPlaced: 0,
    OrderPlacedBy: 0,
    CreatedBy: 0,
    ProductName: "INDERAL LA- 20",
    StoreProductName: "INDERAL LA- 20",
    StoreWiseAmount: 0,
    StoreWiseGSTAmount: 0,
    IsDeleted: 0,
    AllowMinQty: 0,
    AllowMaxQty: 0,
    StepUpValue: 1,
    AllowMOQ: true,
    MinItemLimit: 0,
    MaxItemLimit: 0,
    MinAmountLimit: 0,
    MaxAmountLimit: 0,
    DODIsPrefenceSet: 0,
    IsDODPreferenceSet: 0,
    DisplayHalfSchemeOn: "",
    DisplayHalfScheme: "0",
    RetailerSchemePreference: 1,
    HalfSchemeValueToRetailer: 0,
    RoundOffDisplayHS: "",
    MinOrderQuantity: 0,
    MaxOrderQuantity: 0,
    IsDODProduct: 0,
    IsDODProductCheck: 0,
    IsDODProductSelected: 0, // Added!
    OrderDeliveryModeStatus: 1,
    OrderRemarks: 1,
    SpecialRate: 0,
    Stock: 117,
    RShowPtr: 1,
    IsPartyLocked: 0,
    RewardSchemeId: 0,
    IsProductChecked: 1,
    DeliveryPerson: "",
    DeliveryPersonCode: "",
    RShowPtrForAllCompanies: 1,
    Company: "ABBOTT IND NEUROLIFE",
    IsGroupWisePTR: 0,
    IsGroupWisePTRRetailer: 0,
    RateValidity: null,
    IsShowNonMappedOrderStock: 1,
    RStockVisibility: 0,
    IsMapped: 1,
    ProductId: 76748,
    MRP: "52.00",
    ProductWiseAmount: 0,
    ProductWiseGSTAmount: 0,
    ProductWiseSchemeAmount: 0,
    ProductWiseSchemeGSTAmount: 0,
    StoreWiseSchemeAmount: 0,
    StoreWiseSchemeGSTAmount: 0,
    ProductLock: 0,
    MDMProductCode: null,
    BoxPacking: "0",
    CasePacking: "15 TAB",
    Packing: "15 TAB"
  };

  console.log('Sending AddUserProductCartDetail request to pharmretail-api.pharmarack.com...');
  const res = await fetch('https://pharmretail-api.pharmarack.com/cart/api/v1/AddUserProductCartDetail', {
    method: 'POST',
    headers: {
      'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
      'Content-Type': 'application/json',
      'devicetype': 'web',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://retailers.pharmarack.com/',
      'Origin': 'https://retailers.pharmarack.com'
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  console.log('Result (status ' + res.status + '):', text);
}

main().catch(console.error);
