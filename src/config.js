// The people, the lists, and the starting items. Adding a person = adding one line to USERS
// (plus a PIN_<NAME> secret in Cloudflare) and putting their id in the lists they should see.

export const USERS = [
  { id: 'doug', name: 'Doug', role: 'parent' },
  { id: 'roman', name: 'Roman', role: 'kid' },
];

// members = who can see the list. Kids can check things off and add items, but can only
// edit or delete what they added themselves, and they can not touch sections.
export const LISTS = [
  { key: 'personal', name: 'Personal', members: ['doug'] },
  { key: 'work', name: 'Work', members: ['doug'] },
  { key: 'roman-doug', name: 'Roman and Dad', members: ['doug', 'roman'] },
  { key: 'roman', name: "Roman's To do", members: ['doug', 'roman'] },
  { key: 'wish', name: "Roman's Wish List", members: ['doug', 'roman'] },
];

export const DEFAULT_STORES = ['Harbor Freight', 'Home Depot', 'Amazon', 'Other'];
export const DEFAULT_FOOD_STORES = ['Grocery store', 'Costco', 'Other'];

// Starting items, loaded once into an empty database. An item is a string, or { text, kids: [...] }.
export const SEED = {
  personal: [
    { name: 'House interior', items: ['Plex server', 'Finish the garage hall tree', "Kids' shower", 'Fix the EcoVac'] },
    {
      name: 'House exterior',
      items: [
        { text: 'Roof', kids: ['Standing seam metal roof install', 'Finalize the phased panel order across the 14 facets', 'Moss off'] },
        'Organize the shed',
      ],
    },
    {
      name: 'Home and money',
      items: ['Review insurance policy and decide on the whole life switch', 'Sell the Peloton', 'Sell the Vitruvian', 'Sell the gecko enclosure'],
    },
    {
      name: 'Making money',
      items: [
        'Plate Mate: pre-order pitch',
        'Plate Mate: one page business summary',
        'Plate Mate: cost model spreadsheet',
        'Kalama preschool daycare plan',
        'Paramedic assessment guide app: rebuild content as original work, remove security codes',
        'Boyce Holdings LLC: S Corp election, trust integration, CPA consult',
        'Grow the North Country EMS Training YouTube channel',
        'Home Depot affiliate program: set up a site or social channel, then apply',
        '3D print farm: decide on the EMS/fire/SAR gear niche',
        'Hybrid EMT Basic program in Kelso',
        'Kubota brush cutter attachment and brush work contracting',
        'Patriot Woods rail tourism idea',
      ],
    },
  ],
  work: [{ name: 'To do', items: ['Reset camera on side parking lot'] }],
  'roman-doug': [
    {
      name: 'Projects',
      items: [
        'Motorcycle: put the 225cc Harbor Freight motor in the Coleman 100 TU',
        { text: 'Trailer (1000 lb Harbor Freight)', kids: ['Fixed axle', 'Welding', 'Redo the lights'] },
      ],
    },
  ],
  roman: [{ name: 'To do', items: [] }],
  wish: [{ name: 'Birthday', items: [] }, { name: 'Christmas', items: [] }, { name: 'Anytime ideas', items: [] }],
};
