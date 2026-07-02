const startTime = Date.now();

async function testAll() {
  console.log('Testing local server endpoints...');

  try {
    const t0 = Date.now();
    const searchRes = await fetch('http://localhost:3000/api/pharmarack/search?q=paracetamol');
    console.log(`/search response: ${searchRes.status} in ${Date.now() - t0}ms`);
    const searchData = await searchRes.json();
    console.log('Search matches count:', Array.isArray(searchData) ? searchData.length : 'not an array:', searchData);
  } catch (err) {
    console.error('Search endpoint failed:', err.message);
  }

  try {
    const t1 = Date.now();
    const cartRes = await fetch('http://localhost:3000/api/pharmarack/cart');
    console.log(`/cart response: ${cartRes.status} in ${Date.now() - t1}ms`);
    const cartData = await cartRes.json();
    console.log('Cart keys:', Object.keys(cartData));
  } catch (err) {
    console.error('Cart endpoint failed:', err.message);
  }
}

testAll();
