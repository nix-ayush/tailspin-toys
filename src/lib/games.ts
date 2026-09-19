import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from './db';
import { games, categories, publishers } from '../../db/schema';
import type { Category, Game, Publisher } from '../types/game';

/** Optional filters for narrowing the game catalog. */
export interface GameFilters {
    categoryIds?: number[];
    publisherId?: number;
}

const gameSelection = {
    id: games.id,
    title: games.title,
    description: games.description,
    starRating: games.starRating,
    categoryId: categories.id,
    categoryName: categories.name,
    publisherId: publishers.id,
    publisherName: publishers.name,
};

type GameSelectionRow = {
    id: number;
    title: string;
    description: string;
    starRating: number | null;
    categoryId: number | null;
    categoryName: string | null;
    publisherId: number | null;
    publisherName: string | null;
};

function mapGame(row: GameSelectionRow): Game {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        starRating: row.starRating,
        category:
            row.categoryId !== null && row.categoryName !== null
                ? { id: row.categoryId, name: row.categoryName }
                : null,
        publisher:
            row.publisherId !== null && row.publisherName !== null
                ? { id: row.publisherId, name: row.publisherName }
                : null,
    };
}

function baseGamesQuery(db: Database) {
    return db
        .select(gameSelection)
        .from(games)
        .leftJoin(categories, eq(games.categoryId, categories.id))
        .leftJoin(publishers, eq(games.publisherId, publishers.id));
}

function applyFilters<T extends ReturnType<typeof baseGamesQuery>>(
    query: T,
    filters: GameFilters = {},
): T {
    const conditions = [];
    if (filters.categoryIds !== undefined) {
        conditions.push(
            filters.categoryIds.length === 0
                ? eq(games.id, -1)
                : inArray(games.categoryId, filters.categoryIds),
        );
    }
    if (filters.publisherId !== undefined) {
        conditions.push(eq(games.publisherId, filters.publisherId));
    }
    return conditions.length > 0 ? query.where(and(...conditions)) as T : query;
}

/**
 * Returns games matching optional category and publisher filters in title order.
 *
 * @param db Drizzle database instance, injected for production and tests.
 * @param filters Optional category and publisher criteria.
 * @returns Matching games mapped to the app-facing model.
 */
export async function getGames(db: Database, filters: GameFilters = {}): Promise<Game[]> {
    const rows = await applyFilters(baseGamesQuery(db), filters).orderBy(asc(games.title));
    return rows.map(mapGame);
}

/**
 * Returns all games ordered by title.
 *
 * @param db Drizzle database instance, injected for production and tests.
 * @returns All games mapped to the app-facing model.
 */
export async function getAllGames(db: Database): Promise<Game[]> {
    return getGames(db);
}

/** Returns all game ids ordered by title. */
export async function getAllGameIds(db: Database): Promise<number[]> {
    const rows = await db.select({ id: games.id }).from(games).orderBy(asc(games.title));
    return rows.map((row) => row.id);
}

/**
 * Returns all categories ordered by name for filter controls.
 *
 * @param db Drizzle database instance, injected for production and tests.
 * @returns Categories available in the catalog.
 */
export async function getAllCategories(db: Database): Promise<Category[]> {
    return db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .orderBy(asc(categories.name));
}

/**
 * Returns all publishers ordered by name for filter controls.
 *
 * @param db Drizzle database instance, injected for production and tests.
 * @returns Publishers available in the catalog.
 */
export async function getAllPublishers(db: Database): Promise<Publisher[]> {
    return db
        .select({ id: publishers.id, name: publishers.name })
        .from(publishers)
        .orderBy(asc(publishers.name));
}

/** Returns a single game by id, or null when it does not exist. */
export async function getGameById(db: Database, id: number): Promise<Game | null> {
    const row = await baseGamesQuery(db).where(eq(games.id, id)).get();
    return row ? mapGame(row) : null;
}
