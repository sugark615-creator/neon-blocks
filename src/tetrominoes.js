export const COLS = 10;
export const ROWS = 20;
export const BLOCK_SIZE = 40; // 40px per block

// Tetromino colors with neon glow effects
export const COLORS = [
  'none',
  '#06b6d4', // I - Cyan
  '#3b82f6', // J - Blue
  '#f97316', // L - Orange
  '#eab308', // O - Yellow
  '#22c55e', // S - Green
  '#a855f7', // T - Purple
  '#ef4444'  // Z - Red
];

// Tetromino shapes
export const SHAPES = [
  [],
  // I
  [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ],
  // J
  [
    [2, 0, 0],
    [2, 2, 2],
    [0, 0, 0]
  ],
  // L
  [
    [0, 0, 3],
    [3, 3, 3],
    [0, 0, 0]
  ],
  // O
  [
    [4, 4],
    [4, 4]
  ],
  // S
  [
    [0, 5, 5],
    [5, 5, 0],
    [0, 0, 0]
  ],
  // T
  [
    [0, 6, 0],
    [6, 6, 6],
    [0, 0, 0]
  ],
  // Z
  [
    [7, 7, 0],
    [0, 7, 7],
    [0, 0, 0]
  ]
];

export function rotate(matrix) {
  const N = matrix.length;
  const result = matrix.map((row, i) =>
    row.map((val, j) => matrix[N - 1 - j][i])
  );
  return result;
}
