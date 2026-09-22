# Tag guide — importance tags for ground-truth items
*2026-09-16. Used verbatim as the pre-fill prompt for the structurer and as the reviewer's reference when confirming. Tags describe the item's ROLE on this plate, not the food in general: the same food can be core on one plate and secondary on another. Apply at the finest level where the truth has a gram figure.*

## The tags

| Tag | Weight | Role | Grams required? |
|---|---|---|---|
| core | 1.0 | the protein, the starch, or the named dish itself; the thing you would say you ate | yes |
| secondary | 0.5 | sides, vegetables, sauces and stews served alongside, fats of a tablespoon or more, spreads, toppings that change the dish (avocado on toast, cheese) | yes |
| garnish | 0.1 | herbs, small toppings, small fats (a spray of oil, a teaspoon of butter), a squeeze of lemon, seeds | no |
| spice | 0.05 | spices and seasonings other than salt and pepper: curry powder, chili, garlic powder, cumin | no |
| ignore | 0 | salt, pepper, water, ALL beverages (coffee, tea, juice, milk as a drink, alcohol), ice, inedible parts (bones, peels, shells) | dropped |

## Rules of thumb

1. **A plate usually has one to three cores.** If you would describe the meal as "X with Y", X is core and Y is core if it is a protein or starch, secondary otherwise. "Chicken with potato and roasted vegetables": chicken core, potato core, vegetables secondary.
2. **A composite dish weighed as a whole is one item with one tag.** "Sheet pan vegetables 210 g" is one secondary item; its named components are recorded but not separately tagged or weighed. "Jollof rice 200 g" is one core item even though it contains rice, stew base, and oil.
3. **A stew or soup with meat inside:** if weighed as one bowl, one core item. If the meat was weighed separately, meat core and the stew base secondary.
4. **A fruit bowl or salad with no protein or starch:** each weighed component is core (they are the dish). A salad served beside a protein: the salad is secondary as a whole.
5. **Bread, rice, pasta, oats, potatoes, plantain, yam, cassava:** core when they carry the meal, secondary when they are a small side (a single slice of bread beside eggs).
6. **Eggs:** core when they are the protein of the plate; secondary when one egg sits beside a main protein.
7. **Spreads and toppings** (almond butter, avocado on toast, cheese, hummus): secondary, with an estimated gram figure.
8. **Cooking fats:** secondary if a tablespoon or more (frying oil for plantain), garnish if less (a spray, a teaspoon). The hidden-fat check records them.
9. **Sauces and condiments:** secondary if served in a real quantity (a ladle of stew, gravy), garnish if a dab (pepper sauce, ketchup).
10. **Anything with no gram figure that is core or secondary must be given an estimated figure** by the structurer with basis = estimated. Only garnish and spice may stay gram-less.
11. **Drinks are never items.** Do not record them in the truth; the model is told not to list them; any it lists are dropped.

## Examples

| Note line | Items and tags |
|---|---|
| "Potatoes baked - 150 g - salt, pepper parsley" | potato core 150 g weighed; parsley garnish; salt/pepper ignore |
| "Chicken - 180 g - salt, black pepper, sprinkle of paprika" | chicken core 180 g weighed; paprika spice |
| "Sheet pan vegetables - 210 g - carrots, cauliflower, mushrooms, zucchini, onions" | roasted vegetables secondary 210 g weighed, components recorded; oil per hidden-fat check |
| "Two slices wheat bread, one half medium avocado, one tbsp hummus, 1/2 tuna can - 70 g" | bread core 56 g est; avocado secondary 68 g est; hummus secondary 15 g est; tuna core 70 g weighed |
| "One egg large - 40g kale, sprinkle of tomatoes, olive oil fried" | egg core 50 g est; kale secondary 40 g weighed; tomato garnish; olive oil garnish ~5 g est |
| "1/2 cup uncooked oatmeal with water and honey one tbsp" | oatmeal core 263 g converted (40.5 g dry); honey secondary 21 g est; water ignore |
| "Raspberry 60 g, mango 80 g, kiwi 50 g" (fruit bowl) | each core, weighed |
