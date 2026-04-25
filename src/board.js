import { COLS, ROWS, SHAPES } from './tetrominoes.js';

export class Board {
  constructor() {
    this.grid = this.getEmptyGrid();
    this.piece = null;
    this.nextPiece = null;
  }

  getEmptyGrid() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  }

  reset() {
    this.grid = this.getEmptyGrid();
    this.piece = this.getRandomPiece();
    this.nextPiece = this.getRandomPiece();
  }

  getRandomPiece() {
    const typeId = Math.floor(Math.random() * (SHAPES.length - 1)) + 1;
    const shape = SHAPES[typeId];
    return {
      typeId,
      shape,
      x: typeId === 4 ? 4 : 3, // O is 2x2, others are 3x3 or 4x4
      y: typeId === 1 ? -1 : 0  // I is 4x4
    };
  }

  spawnNextPiece() {
    this.piece = this.nextPiece;
    this.nextPiece = this.getRandomPiece();
    return this.valid(this.piece);
  }

  valid(piece) {
    for (let y = 0; y < piece.shape.length; y++) {
      for (let x = 0; x < piece.shape[y].length; x++) {
        if (piece.shape[y][x] > 0) {
          const boardX = piece.x + x;
          const boardY = piece.y + y;

          // Wall and bottom collision
          if (boardX < 0 || boardX >= COLS || boardY >= ROWS) {
            return false;
          }

          // Block collision (ignore negative Y for blocks spawning above board)
          if (boardY >= 0 && this.grid[boardY][boardX] > 0) {
            return false;
          }
        }
      }
    }
    return true;
  }

  freeze() {
    // First pass: verify all blocks fit within the board
    for (let y = 0; y < this.piece.shape.length; y++) {
      for (let x = 0; x < this.piece.shape[y].length; x++) {
        if (this.piece.shape[y][x] > 0 && this.piece.y + y < 0) {
          return false; // signals game over
        }
      }
    }
    // Second pass: commit the piece to the grid
    for (let y = 0; y < this.piece.shape.length; y++) {
      for (let x = 0; x < this.piece.shape[y].length; x++) {
        if (this.piece.shape[y][x] > 0) {
          this.grid[this.piece.y + y][this.piece.x + x] = this.piece.shape[y][x];
        }
      }
    }
    return true; // signals piece placed successfully
  }

  // Return indices (top→bottom) of fully filled rows without modifying the grid.
  findFullLines() {
    const rows = [];
    for (let y = 0; y < ROWS; y++) {
      if (this.grid[y].every(value => value > 0)) {
        rows.push(y);
      }
    }
    return rows;
  }

  clearLines() {
    let linesCleared = 0;

    // Check from bottom to top
    for (let y = ROWS - 1; y >= 0; y--) {
      if (this.grid[y].every(value => value > 0)) {
        // Remove the row
        this.grid.splice(y, 1);
        // Add new empty row at top
        this.grid.unshift(Array(COLS).fill(0));
        linesCleared++;
        y++; // Check the same row index again as everything shifted down
      }
    }

    return linesCleared;
  }
}
