export type CartAddListener = (item: any, quantity: number) => void;
const cartAddListeners = new Set<CartAddListener>();

export const cartEvents = {
  subscribe(listener: CartAddListener) {
    cartAddListeners.add(listener);
    return () => {
      cartAddListeners.delete(listener);
    };
  },
  emit(item: any, quantity: number) {
    cartAddListeners.forEach(listener => {
      try {
        listener(item, quantity);
      } catch (err) {
        console.error('Error in cart listener:', err);
      }
    });
  }
};
