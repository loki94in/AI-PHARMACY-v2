// Using native fetch

async function testCart() {
  try {
    const res = await fetch('http://127.0.0.1:3000/api/pharmarack/cart', {
      headers: {
        'x-session-token': 'mock-dev-session-token'
      }
    });
    console.log('Status:', res.status);
    const json = await res.json();
    console.log('JSON:', json);
  } catch (err) {
    console.error('Error:', err);
  }
}

testCart();
