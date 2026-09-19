import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { Database } from './db';
import { games, categories, publishers } from '../../db/schema';
import type { Category, Game, Publisher } from '../types/game';

/** Optional filters for narrowing the game catalog. */
export interface GameFilters {
    categoryIds?: number[];
    publisherId?: number;
}

export interface GamePage {
    games: Game[];
    page: number;
    pageSize: number;
    totalGames: number;
    totalPages: number;
}

/**
 * Filters games by a case-insensitive title substring.
 *
 * @param gamesToFilter Games to search.
 * @param query Search text; blank text returns every game.
 * @returns Games whose titles contain the normalized query.
 */
export function filterGamesByTitle(gamesToFilter: Game[], query: string): Game[] {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (normalizedQuery === '') {
        return gamesToFilter;
    }

    return gamesToFilter.filter((game) => game.title.toLocaleLowerCase().includes(normalizedQuery));
}

/**
 * Returns a new game array ordered by the selected catalog sort.
 *
 * Unrated games are placed after rated games for rating order, while title
 * ordering uses a case-insensitive comparison with id as a stable tie-breaker.
 *
 * @param gamesToSort Games to order.
 * @param sort Sort mode to apply.
 * @returns A sorted copy of the games.
 */
export function sortGames(
    gamesToSort: Game[],
    sort: 'title-asc' | 'title-desc' | 'rating-desc',
): Game[] {
    return [...gamesToSort].sort((left, right) => {
        if (sort === 'rating-desc') {
            if (left.starRating === null && right.starRating === null) {
                return left.id - right.id;
            }
            if (left.starRating === null) return 1;
            if (right.starRating === null) return -1;
            return right.starRating - left.starRating || left.id - right.id;
        }

        const titleComparison = left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
        return (sort === 'title-desc' ? -titleComparison : titleComparison) || left.id - right.id;
    });
}

const gameSelection = {
    id: games.id,
    title: games.title,
    description: games.description,
    starRating: games.starRating,
    categoryId: categories.id,
    categoryName: categories.name,
    categoryDescription: categories.description,
    publisherId: publishers.id,
    publisherName: publishers.name,
    publisherDescription: publishers.description,
};

type GameSelectionRow = {
    id: number;
    title: string;
    description: string;
    starRating: number | null;
    categoryId: number | null;
    categoryName: string | null;
    categoryDescription: string | null;
    publisherId: number | null;
    publisherName: string | null;
    publisherDescription: string | null;
};

function mapGame(row: GameSelectionRow): Game {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        starRating: row.starRating,
        category:
            row.categoryId !== null && row.categoryName !== null
                ? {
                    id: row.categoryId,
                    name: row.categoryName,
                    description: row.categoryDescription,
                }
                : null,
        publisher:
            row.publisherId !== null && row.publisherName !== null
                ? {
                    id: row.publisherId,
                    name: row.publisherName,
                    description: row.publisherDescription,
                }
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

function baseGamesCountQuery(db: Database) {
    return db.select({ count: count() }).from(games);
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
 * Returns one deterministic page of filtered games and its pagination metadata.
 *
 * @param db Drizzle database instance, injected for production and tests.
 * @param page One-based page number; values below one are treated as page one.
 * @param pageSize Number of games per page.
 * @param filters Optional category and publisher criteria.
 * @returns Games for the requested page and total page metadata.
 */
export async function getGamesPage(
    db: Database,
    page: number,
    pageSize: number,
    filters: GameFilters = {},
): Promise<GamePage> {
    const safePageSize = Math.max(1, Math.floor(pageSize));
    const countQuery = baseGamesCountQuery(db);
    const countConditions = [];
    if (filters.categoryIds !== undefined) {
        countConditions.push(
            filters.categoryIds.length === 0
                ? eq(games.id, -1)
                : inArray(games.categoryId, filters.categoryIds),
        );
    }
    if (filters.publisherId !== undefined) {
        countConditions.push(eq(games.publisherId, filters.publisherId));
    }
    const countRow = await (countConditions.length > 0
        ? countQuery.where(and(...countConditions))
        : countQuery).get();
    const totalGames = countRow?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalGames / safePageSize));
    const safePage = Math.min(Math.max(1, Math.floor(page)), totalPages);
    const rows = await applyFilters(baseGamesQuery(db), filters)
        .orderBy(asc(games.title))
        .limit(safePageSize)
        .offset((safePage - 1) * safePageSize);

    return {
        games: rows.map(mapGame),
        page: safePage,
        pageSize: safePageSize,
        totalGames,
        totalPages,
    };
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
        .select({ id: publishers.id, name: publishers.name, description: publishers.description })
        .from(publishers)
        .orderBy(asc(publishers.name));
}

/**
 * Returns a publisher and its description, or null when it does not exist.
 *
 * @param db Drizzle database instance, injected for production and tests.
 * @param id Publisher id to look up.
 * @returns The publisher record or null.
 */
export async function getPublisherById(db: Database, id: number): Promise<Publisher | null> {
    const publisher = await db
        .select({ id: publishers.id, name: publishers.name, description: publishers.description })
        .from(publishers)
        .where(eq(publishers.id, id))
        .get();
    return publisher ?? null;
}

/**
 * Returns all games belonging to a publisher in title order.
 *
 * @param db Drizzle database instance, injected for production and tests.
 * @param publisherId Publisher id to filter by.
 * @returns Games published by the requested publisher.
 */
export async function getGamesByPublisher(db: Database, publisherId: number): Promise<Game[]> {
    return getGames(db, { publisherId });
}

/** Returns a single game by id, or null when it does not exist. */
export async function getGameById(db: Database, id: number): Promise<Game | null> {
    const row = await baseGamesQuery(db).where(eq(games.id, id)).get();
    return row ? mapGame(row) : null;
}
