-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('breakfast', 'lunch', 'dinner', 'snack');

-- AlterTable
ALTER TABLE "Meal" ADD COLUMN     "mealType" "MealType";
