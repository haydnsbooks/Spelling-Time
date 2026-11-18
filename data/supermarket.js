/* SUPERMARKET STOCK
   Each aisle is a tab in the Supermarket and a compartment in the Fridge.
   shelves[0] is the TOP shelf (dearest items) and the last shelf is the BOTTOM shelf (cheapest).
   Every item is [id, emoji, name, price in Fremantium]. There is only one of each item.

   The prices add up to exactly 648 Fremantium: the most a student can earn in a year
   (36 weeks × a gold week, which pays 3 for bronze + 5 for silver + 10 for gold = 18).
   So the only way to buy everything is gold in every week of the year.

   If you change any item or price, add 1 to "version". Students' purchases are then
   restocked and their Fremantium goes back to what they have earned. */
window.SUPERMARKET = {
  version: 1,
  aisles: [
    { id: 'fruit', name: 'Fruit', icon: '🍎', fridge: 'Fruit drawer', colour: '#e8505b', shelves: [
      [['pineapple','🍍','Pineapple',21], ['mango','🥭','Mango',19]],
      [['watermelon','🍉','Watermelon',10], ['coconut','🥥','Coconut',9], ['grapes','🍇','Grapes',8], ['rockmelon','🍈','Rockmelon',7]],
      [['strawberries','🍓','Strawberries',5], ['cherries','🍒','Cherries',5], ['blueberries','🫐','Blueberries',4], ['peach','🍑','Peach',4], ['kiwifruit','🥝','Kiwifruit',4]],
      [['redapple','🍎','Red apple',3], ['greenapple','🍏','Green apple',3], ['pear','🍐','Pear',2], ['banana','🍌','Banana',2], ['mandarin','🍊','Mandarin',2]]
    ]},
    { id: 'veg', name: 'Vegetables', icon: '🥕', fridge: 'Veggie drawer', colour: '#3fa34d', shelves: [
      [['avocado','🥑','Avocado',21], ['eggplant','🍆','Eggplant',19]],
      [['broccoli','🥦','Broccoli',10], ['capsicum','🫑','Capsicum',9], ['mushroom','🍄','Mushroom',8], ['lettuce','🥬','Lettuce',7]],
      [['corn','🌽','Corn',5], ['chilli','🌶️','Chilli',5], ['cucumber','🥒','Cucumber',4], ['tomato','🍅','Tomato',4], ['sweetpotato','🍠','Sweet potato',4]],
      [['carrot','🥕','Carrot',3], ['potato','🥔','Potato',3], ['onion','🧅','Onion',2], ['garlic','🧄','Garlic',2], ['olives','🫒','Olives',2]]
    ]},
    { id: 'dairy', name: 'Dairy & Breakfast', icon: '🧀', fridge: 'Top shelf', colour: '#f2b134', shelves: [
      [['cheesewheel','🧀','Cheese wheel',21], ['honey','🍯','Honey pot',19]],
      [['pancakes','🥞','Pancakes',10], ['waffles','🧇','Waffles',9], ['croissant','🥐','Croissant',8], ['butter','🧈','Butter',7]],
      [['bagel','🥯','Bagel',5], ['baguette','🥖','Baguette',5], ['milk','🥛','Milk',4], ['friedegg','🍳','Fried egg',4], ['pretzel','🥨','Pretzel',4]],
      [['eggs','🥚','Eggs',3], ['bread','🍞','Bread',3], ['cereal','🥣','Cereal',2], ['flatbread','🫓','Flatbread',2], ['peanuts','🥜','Peanuts',2]]
    ]},
    { id: 'butcher', name: 'Butcher & Seafood', icon: '🦐', fridge: 'Middle shelf', colour: '#d9534f', shelves: [
      [['lobster','🦞','Lobster',21], ['steak','🥩','Steak',19]],
      [['crab','🦀','Crab',10], ['oysters','🦪','Oysters',9], ['sushi','🍣','Sushi',8], ['squid','🦑','Squid',7]],
      [['prawns','🦐','Prawns',5], ['fish','🐟','Whole fish',5], ['octopus','🐙','Octopus',4], ['drumstick','🍗','Drumstick',4], ['lambshank','🍖','Lamb shank',4]],
      [['snag','🌭','Snag in bread',3], ['bacon','🥓','Bacon',3], ['prawncutlet','🍤','Prawn cutlet',2], ['fishcake','🍥','Fish cake',2], ['skewer','🍢','Skewer',2]]
    ]},
    { id: 'drinks', name: 'Drinks & Pantry', icon: '🧃', fridge: 'Door shelves', colour: '#3a8fd9', shelves: [
      [['bubbletea','🧋','Bubble tea',21], ['teapot','🫖','Teapot',19]],
      [['thickshake','🥤','Thickshake',10], ['juicebox','🧃','Juice box',9], ['hotchoc','☕','Hot chocolate',8], ['greentea','🍵','Green tea',7]],
      [['icedtea','🧉','Iced tea',5], ['soup','🥫','Tin of soup',5], ['jam','🫙','Jam jar',4], ['ice','🧊','Ice cubes',4], ['lemon','🍋','Lemon',4]],
      [['salt','🧂','Salt',3], ['water','💧','Spring water',3], ['rice','🍚','Rice',2], ['dumplings','🥟','Dumplings',2], ['noodles','🍜','Noodles',2]]
    ]},
    { id: 'frozen', name: 'Frozen & Treats', icon: '🍦', fridge: 'Freezer', colour: '#8a63d2', shelves: [
      [['cake','🎂','Ice-cream cake',21], ['sundae','🍨','Sundae',19]],
      [['cheesecake','🍰','Cheesecake',10], ['pie','🥧','Pie',9], ['snowcone','🍧','Snow cone',8], ['softserve','🍦','Soft serve',7]],
      [['donut','🍩','Doughnut',5], ['cupcake','🧁','Cupcake',5], ['pudding','🍮','Pudding',4], ['chocolate','🍫','Chocolate',4], ['cookie','🍪','Cookie',4]],
      [['lollipop','🍭','Lollipop',3], ['lolly','🍬','Lolly',3], ['mochi','🍡','Mochi',2], ['pizza','🍕','Frozen pizza',2], ['mooncake','🥮','Mooncake',2]]
    ]}
  ]
};
