import { sortByNameThenPrice } from '../src/lib/dishSort.js'

const rows = [
  { name: 'Xôi gà', price: 40000, qty: 2 },
  { name: 'Bánh mì', price: 20000, qty: 5 },
  { name: 'xôi gà ', price: 30000, qty: 1 },
  { name: 'Xôi Gà', price: 35000, qty: 3 },
  { name: 'Nước đậu', price: 10000, qty: 4 },
]

const out = sortByNameThenPrice(rows, (r) => r.price, (r) => r.qty)
console.log(out.map((r) => `${r.name} | ${r.price} | x${r.qty}`).join('\n'))

// Kiem tra: cac dong cung ten phai lien ke
const names = out.map((r) => r.name.trim().toLowerCase())
const groups = []
for (const n of names) {
  if (!groups.length || groups[groups.length - 1] !== n) groups.push(n)
}
console.log('\nNhom (khong trung lap):', groups.join(' | '))
console.log('Lien ke dung:', groups.length === new Set(groups).size)
