async function testEndpoints() {
  try {
    // 1. Test Search
    const searchRes = await fetch('http://127.0.0.1:3001/api/pharmarack/search?q=paracetamol', {
      headers: { 'x-session-token': 'mock-dev-session-token' }
    });
    console.log('Search Status:', searchRes.status);
    const searchJson = await searchRes.json();
    console.log('Search Results:', searchJson);

    // 2. Test Add Cart
    const addRes = await fetch('http://127.0.0.1:3001/api/pharmarack/cart/add', {
      method: 'POST',
      headers: { 
        'x-session-token': 'mock-dev-session-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ items: [{ productId: 2001, storeId: 101, qty: 10 }] })
    });
    console.log('Add Cart Status:', addRes.status);
    const addJson = await addRes.json();
    console.log('Add Cart Response:', addJson);
  } catch (err) {
    console.error('Error running verification tests:', err);
  }
}

testEndpoints();
