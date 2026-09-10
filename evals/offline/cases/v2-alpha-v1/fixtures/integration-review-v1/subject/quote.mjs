export function itemTotal(items, discount) {
  return items.reduce((total, price) => total + price, 0) * (1 - discount);
}

export function quote(items, discount, delivery) {
  return itemTotal([...items, delivery], discount);
}
