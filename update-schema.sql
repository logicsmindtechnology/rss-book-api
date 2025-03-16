-- Update the books table to add missing columns
ALTER TABLE books
ADD COLUMN IF NOT EXISTS publisherUrl VARCHAR(255) NULL,
ADD COLUMN IF NOT EXISTS bookType ENUM('internal', 'external') DEFAULT 'internal',
ADD COLUMN IF NOT EXISTS stock INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS created_by INT NULL,
ADD COLUMN IF NOT EXISTS updated_by INT NULL;

-- Update the existing books to have the bookType field
UPDATE books SET bookType = 'internal' WHERE bookType IS NULL;
