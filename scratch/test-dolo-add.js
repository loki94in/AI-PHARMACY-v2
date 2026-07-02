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
  rows.forEach(r => { settings[r.key] = r.value; });
  await db.close();

  const token = settings['pharmarack_session_token'];
  if (!token) {
    console.error('No Pharmarack token!');
    return;
  }

  // 1. Search for DOLO 650
  console.log('Searching for Dolo 650...');
  const searchPayload = {
    SearchKeyword: 'dolo 650',
    StoreId: [],
    NonMappedStoreId: [],
    Count: 10,
    SkipCount: 0,
    isMappedSearch: null,
    IsStock: 2,
    IsScheme: 2,
    IsSort: 1,
    CartSource: 'MOVP'
  };

  const searchRes = await fetch('https://pharmretail-elasticsearch.pharmarack.com/open-search/api/v2/search', {
    method: 'POST',
    headers: {
      'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
      'Content-Type': 'application/json',
      'devicetype': 'web',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://retailers.pharmarack.com/',
      'Origin': 'https://retailers.pharmarack.com'
    },
    body: JSON.stringify(searchPayload)
  });

  if (!searchRes.ok) {
    console.error('Search failed:', searchRes.status, await searchRes.text());
    return;
  }

  const searchData = await searchRes.json();
  const matched = searchData.data.find(p => p.StoreName === 'S.B.JOSHI & Co.') || searchData.data[0];
  if (!matched) {
    console.error('No matching product found on Pharmarack!');
    return;
  }

  console.log('Found product matching "S.B.JOSHI & Co.":', {
    ProductName: matched.ProductName || matched.ProductFullName,
    ProductId: matched.PrProductId || matched.ProductId,
    ProductCode: matched.ProductCode,
    StoreId: matched.StoreId,
    StoreName: matched.StoreName,
    PTR: matched.PTR,
    MRP: matched.MRP,
    Company: matched.Company,
    Scheme: matched.Scheme || matched.SchemeDescription || matched.ProductScheme
  });

  // 2. Add to cart
  const rateVal = matched.PTR || 0;
  const payload = {
    StoreId: matched.StoreId,
    StoreName: matched.StoreName || '',
    ProductCode: matched.ProductCode || '',
    Quantity: 3,
    PTR: rateVal,
    Free: 0,
    HiddenPTR: rateVal,
    NetRate: rateVal,
    Scheme: matched.Scheme || matched.SchemeDescription || matched.ProductScheme || '',
    SchemeType: '',
    GSTPercentage: 0,
    ItemGSTValue: 0,
    CartSource: 'MOVP',
    DeliveryOption: '',
    RemarkForStore: '',
    ProductAddedBy: 0,
    Priority: '',
    OrderPlaced: 0,
    OrderPlacedBy: 0,
    CreatedBy: 0,
    ProductName: matched.ProductName || matched.ProductFullName || '',
    StoreProductName: matched.ProductName || matched.ProductFullName || '',
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
    DisplayHalfSchemeOn: '',
    DisplayHalfScheme: '0',
    RetailerSchemePreference: 1,
    HalfSchemeValueToRetailer: 0,
    RoundOffDisplayHS: '',
    MinOrderQuantity: 0,
    MaxOrderQuantity: 0,
    IsDODProduct: 0,
    IsDODProductCheck: 0,
    IsDODProductSelected: 0,
    OrderDeliveryModeStatus: 1,
    OrderRemarks: 1,
    SpecialRate: 0,
    Stock: matched.Stock || 999,
    RShowPtr: 1,
    IsPartyLocked: 0,
    RewardSchemeId: 0,
    IsProductChecked: 1,
    DeliveryPerson: '',
    DeliveryPersonCode: '',
    RShowPtrForAllCompanies: 1,
    Company: matched.Company || '',
    IsGroupWisePTR: 0,
    IsGroupWisePTRRetailer: 0,
    RateValidity: null,
    IsShowNonMappedOrderStock: 1,
    RStockVisibility: 0,
    IsMapped: 1,
    ProductId: matched.PrProductId || matched.ProductId,
    MRP: String(matched.MRP || rateVal),
    ProductWiseAmount: 0,
    ProductWiseGSTAmount: 0,
    ProductWiseSchemeAmount: 0,
    ProductWiseSchemeGSTAmount: 0,
    StoreWiseSchemeAmount: 0,
    StoreWiseSchemeGSTAmount: 0,
    ProductLock: 0,
    MDMProductCode: null,
    BoxPacking: '0',
    CasePacking: matched.Packing || '1 strip',
    Packing: matched.Packing || '1 strip'
  };

  console.log('Sending AddUserProductCartDetail request...');
  const response = await fetch('https://pharmretail-api.pharmarack.com/cart/api/v1/AddUserProductCartDetail', {
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

  console.log('Response Status:', response.status);
  const text = await response.text();
  console.log('Response Text:', text);
}

main().catch(console.error);
