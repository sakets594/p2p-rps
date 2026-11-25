// Things to act out in emoji. Lowercase letters, digits and single spaces, at most four words.
// Each group has a label the guesser sees as a clue.
export const CATEGORIES = {
  movie: {label: 'Movie', icon: '🎬'},
  food: {label: 'Food', icon: '🍽️'},
  place: {label: 'Place', icon: '📍'},
  animal: {label: 'Animal', icon: '🐾'},
  action: {label: 'Action or moment', icon: '🎭'},
};

export const PHRASES = [
  ...['lion king', 'frozen', 'titanic', 'harry potter', 'spider man', 'finding nemo', 'toy story', 'jurassic park', 'star wars', 'batman',
    'shrek', 'jaws', 'ice age', 'kung fu panda', 'the avengers', 'cars', 'minions', 'aladdin', 'moana', 'inside out'].map((text) => ({text, cat: 'movie'})),
  ...['pizza', 'ice cream', 'hot dog', 'french fries', 'birthday cake', 'sushi', 'spaghetti', 'popcorn', 'chocolate', 'pancakes',
    'taco', 'watermelon', 'sandwich', 'noodles', 'coffee', 'cheese burger'].map((text) => ({text, cat: 'food'})),
  ...['eiffel tower', 'taj mahal', 'beach', 'mount everest', 'space station', 'amusement park', 'swimming pool', 'airport', 'hospital',
    'school bus', 'desert', 'jungle', 'north pole', 'cinema', 'library', 'volcano'].map((text) => ({text, cat: 'place'})),
  ...['dolphin', 'panda', 'penguin', 'butterfly', 'kangaroo', 'octopus', 'elephant', 'monkey', 'shark', 'dinosaur', 'owl', 'tiger'].map((text) => ({text, cat: 'animal'})),
  ...['brush teeth', 'birthday party', 'video call', 'traffic jam', 'road trip', 'fishing', 'playing guitar', 'going to school', 'full moon',
    'first date', 'power cut', 'sleeping in', 'rainy day', 'new year', 'fire drill', 'selfie'].map((text) => ({text, cat: 'action'})),
];
