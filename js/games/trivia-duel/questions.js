// The question bank for Trivia Duel. `a` lists the options and `correct` is the index of the right
// one in that list; the match shuffles the options per question (so the right answer is not always in
// the same slot) using a seed both players share. Add as many as you like: each game draws a fresh set.

export const QUESTIONS = [
  // Science and nature
  {q: 'Which planet is known as the Red Planet?', a: ['Mars', 'Venus', 'Jupiter', 'Mercury'], correct: 0},
  {q: 'What gas do plants take in from the air to make food?', a: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Helium'], correct: 1},
  {q: 'How many legs does a spider have?', a: ['Six', 'Eight', 'Ten', 'Twelve'], correct: 1},
  {q: 'What is the hardest natural substance?', a: ['Gold', 'Iron', 'Diamond', 'Quartz'], correct: 2},
  {q: 'What is the chemical symbol for water?', a: ['O2', 'CO2', 'H2O', 'HO'], correct: 2},
  {q: 'Which is the largest mammal?', a: ['African elephant', 'Blue whale', 'Giraffe', 'Hippopotamus'], correct: 1},
  {q: 'How many bones does an adult human have (about)?', a: ['106', '206', '306', '406'], correct: 1},
  {q: 'Which organ pumps blood around the body?', a: ['Liver', 'Lungs', 'Heart', 'Kidney'], correct: 2},
  {q: 'What is the closest star to Earth?', a: ['Polaris', 'Sirius', 'Proxima Centauri', 'The Sun'], correct: 3},
  {q: 'Which of these is a primary colour of light?', a: ['Yellow', 'Green', 'Orange', 'Purple'], correct: 1},
  {q: 'At what temperature (°C) does water boil at sea level?', a: ['90', '100', '110', '120'], correct: 1},
  {q: 'Which animal is the fastest on land?', a: ['Lion', 'Horse', 'Cheetah', 'Greyhound'], correct: 2},

  // Geography
  {q: 'What is the capital of Japan?', a: ['Kyoto', 'Osaka', 'Tokyo', 'Nagoya'], correct: 2},
  {q: 'Which holy river flows through Varanasi?', a: ['Yamuna', 'Ganga', 'Godavari', 'Narmada'], correct: 1},
  {q: 'Which is the largest ocean?', a: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correct: 3},
  {q: 'Mount Everest lies on the border of Nepal and which country?', a: ['India', 'China (Tibet)', 'Bhutan', 'Pakistan'], correct: 1},
  {q: 'Which continent is Egypt in?', a: ['Asia', 'Europe', 'Africa', 'South America'], correct: 2},
  {q: 'What is the capital of Australia?', a: ['Sydney', 'Melbourne', 'Canberra', 'Perth'], correct: 2},
  {q: 'Which desert is the largest hot desert in the world?', a: ['Gobi', 'Thar', 'Sahara', 'Kalahari'], correct: 2},
  {q: 'Which country has the city of Marrakesh?', a: ['Morocco', 'Egypt', 'Tunisia', 'Turkey'], correct: 0},
  {q: 'How many states does India have?', a: ['26', '28', '30', '32'], correct: 1},
  {q: 'Which Indian city is known as the Pink City?', a: ['Jodhpur', 'Udaipur', 'Jaipur', 'Agra'], correct: 2},

  // India and culture
  {q: 'Who is known as the Father of the Nation in India?', a: ['Jawaharlal Nehru', 'Mahatma Gandhi', 'Sardar Patel', 'B. R. Ambedkar'], correct: 1},
  {q: 'The Taj Mahal is in which city?', a: ['Delhi', 'Lucknow', 'Agra', 'Jaipur'], correct: 2},
  {q: 'Which festival is called the festival of lights?', a: ['Holi', 'Diwali', 'Eid', 'Baisakhi'], correct: 1},
  {q: 'Which is India’s national animal?', a: ['Lion', 'Elephant', 'Tiger', 'Leopard'], correct: 2},
  {q: 'In which year did India become independent?', a: ['1945', '1947', '1950', '1952'], correct: 1},
  {q: 'Which sport is Sachin Tendulkar famous for?', a: ['Hockey', 'Cricket', 'Tennis', 'Football'], correct: 1},
  {q: 'Which is the national flower of India?', a: ['Rose', 'Lotus', 'Marigold', 'Jasmine'], correct: 1},
  {q: 'How many colours are in the Indian national flag?', a: ['Two', 'Three', 'Four', 'Five'], correct: 1},

  // General knowledge
  {q: 'How many days are there in a leap year?', a: ['364', '365', '366', '367'], correct: 2},
  {q: 'How many sides does a hexagon have?', a: ['Five', 'Six', 'Seven', 'Eight'], correct: 1},
  {q: 'What is the square root of 81?', a: ['7', '8', '9', '11'], correct: 2},
  {q: 'What is 12 × 12?', a: ['124', '132', '144', '154'], correct: 2},
  {q: 'Which instrument has black and white keys?', a: ['Guitar', 'Piano', 'Flute', 'Drum'], correct: 1},
  {q: 'How many players are on a football (soccer) team on the field?', a: ['9', '10', '11', '12'], correct: 2},
  {q: 'Which metal is liquid at room temperature?', a: ['Mercury', 'Lead', 'Tin', 'Zinc'], correct: 0},
  {q: 'Which language has the most native speakers in the world?', a: ['English', 'Spanish', 'Mandarin Chinese', 'Hindi'], correct: 2},
  {q: 'What do bees make?', a: ['Silk', 'Honey', 'Milk', 'Wax paper'], correct: 1},
  {q: 'How many minutes are in two hours?', a: ['90', '100', '120', '150'], correct: 2},
  {q: 'Which month has the fewest days?', a: ['January', 'February', 'April', 'June'], correct: 1},
  {q: 'Who wrote the play Romeo and Juliet?', a: ['Charles Dickens', 'William Shakespeare', 'Mark Twain', 'Jane Austen'], correct: 1},
  {q: 'What is the largest planet in our solar system?', a: ['Saturn', 'Neptune', 'Jupiter', 'Earth'], correct: 2},
  {q: 'Which direction does the sun rise in?', a: ['North', 'South', 'East', 'West'], correct: 2},
  {q: 'Which is the tallest animal?', a: ['Elephant', 'Giraffe', 'Camel', 'Ostrich'], correct: 1},
  {q: 'What is the currency of the United Kingdom?', a: ['Euro', 'Dollar', 'Pound sterling', 'Franc'], correct: 2},
];
