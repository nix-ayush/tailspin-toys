import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../db/test-helpers';
import { categories, publishers, games } from '../../db/schema';
import type { Database } from './db';
import {
    getAllGames,
    getAllGameIds,
    getGames,
    getGamesPage,
    getGameById,
    getGamesByPublisher,
    getPublisherById,
    filterGamesByTitle,
    sortGames,
} from './games';

async function seedGames(db: Database, count: number): Promise<void> {
    const [category] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'cat' })
        .returning({ id: categories.id });
    const [publisher] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'pub' })
        .returning({ id: publishers.id });

    // Insert titles in reverse-alphabetical order to prove ordering is applied.
    for (let i = count; i >= 1; i--) {
        await db.insert(games).values({
            title: `Game ${String(i).padStart(2, '0')}`,
            description: `Description ${i}`,
            starRating: 4.2,
            categoryId: category.id,
            publisherId: publisher.id,
        });
    }
}

describe('games data-access helpers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    describe('filterGamesByTitle', () => {
        it('matches titles case-insensitively and ignores surrounding whitespace', () => {
            const results = filterGamesByTitle(
                [
                    { id: 1, title: 'Code Quest', description: '', starRating: null, category: null, publisher: null },
                    { id: 2, title: 'Garden Tactics', description: '', starRating: null, category: null, publisher: null },
                ],
                '  CODE  ',
            );

            expect(results.map((game) => game.title)).toEqual(['Code Quest']);
        });

        it('returns all games for a blank query', () => {
            const games = [
                { id: 1, title: 'Code Quest', description: '', starRating: null, category: null, publisher: null },
            ];

            expect(filterGamesByTitle(games, '   ')).toBe(games);
        });
    });

    describe('sortGames', () => {
        const games = [
            { id: 1, title: 'Bravo', description: '', starRating: 3.5, category: null, publisher: null },
            { id: 2, title: 'Alpha', description: '', starRating: 4.8, category: null, publisher: null },
            { id: 3, title: 'Charlie', description: '', starRating: null, category: null, publisher: null },
        ];

        it('sorts titles in ascending and descending order', () => {
            expect(sortGames(games, 'title-asc').map((game) => game.title)).toEqual(['Alpha', 'Bravo', 'Charlie']);
            expect(sortGames(games, 'title-desc').map((game) => game.title)).toEqual(['Charlie', 'Bravo', 'Alpha']);
        });

        it('puts unrated games last when sorting by rating', () => {
            expect(sortGames(games, 'rating-desc').map((game) => game.title)).toEqual(['Alpha', 'Bravo', 'Charlie']);
        });
    });

    it('returns all games ordered by title', async () => {
        await seedGames(db, 3);
        const all = await getAllGames(db);
        expect(all.map((g) => g.title)).toEqual(['Game 01', 'Game 02', 'Game 03']);
        expect(all[0].category).toEqual({ id: expect.any(Number), name: 'Strategy' });
        expect(all[0].publisher).toEqual({
            id: expect.any(Number),
            name: 'Pub One',
            description: 'pub',
        });
    });

    it('returns a bounded page with deterministic metadata', async () => {
        await seedGames(db, 7);

        const page = await getGamesPage(db, 2, 3);

        expect(page.totalGames).toBe(7);
        expect(page.totalPages).toBe(3);
        expect(page.page).toBe(2);
        expect(page.games.map((game) => game.title)).toEqual([
            'Game 04',
            'Game 05',
            'Game 06',
        ]);
    });

    it('clamps invalid page numbers to the available page range', async () => {
        await seedGames(db, 2);

        const page = await getGamesPage(db, 99, 3);

        expect(page.page).toBe(1);
        expect(page.totalPages).toBe(1);
        expect(page.games).toHaveLength(2);
    });

    it('returns all game ids ordered by title', async () => {
        await seedGames(db, 3);
        const ids = await getAllGameIds(db);
        const all = await getAllGames(db);
        expect(ids).toEqual(all.map((g) => g.id));
    });

    it('filters games by category and publisher together', async () => {
        const [strategy] = await db
            .insert(categories)
            .values({ name: 'Strategy', description: 'strategy' })
            .returning({ id: categories.id });
        const [party] = await db
            .insert(categories)
            .values({ name: 'Party', description: 'party' })
            .returning({ id: categories.id });
        const [firstPublisher] = await db
            .insert(publishers)
            .values({ name: 'First Publisher', description: 'first' })
            .returning({ id: publishers.id });
        const [secondPublisher] = await db
            .insert(publishers)
            .values({ name: 'Second Publisher', description: 'second' })
            .returning({ id: publishers.id });

        await db.insert(games).values([
            {
                title: 'Strategy Match',
                description: 'matches both filters',
                categoryId: strategy.id,
                publisherId: firstPublisher.id,
            },
            {
                title: 'Party Match',
                description: 'matches publisher only',
                categoryId: party.id,
                publisherId: firstPublisher.id,
            },
            {
                title: 'Other Match',
                description: 'matches category only',
                categoryId: strategy.id,
                publisherId: secondPublisher.id,
            },
        ]);

        const filtered = await getGames(db, {
            categoryIds: [strategy.id],
            publisherId: firstPublisher.id,
        });
        expect(filtered.map((game) => game.title)).toEqual(['Strategy Match']);

        const eitherCategory = await getGames(db, {
            categoryIds: [strategy.id, party.id],
        });
        expect(eitherCategory.map((game) => game.title)).toEqual([
            'Other Match',
            'Party Match',
            'Strategy Match',
        ]);
    });

    it('returns no games when a selected category has no matches', async () => {
        await seedGames(db, 1);
        const [unusedCategory] = await db
            .insert(categories)
            .values({ name: 'Unused', description: 'unused' })
            .returning({ id: categories.id });

        expect(await getGames(db, { categoryIds: [unusedCategory.id] })).toEqual([]);
    });

    it('fetches a single game by id', async () => {
        await seedGames(db, 2);
        const ids = await getAllGameIds(db);
        const game = await getGameById(db, ids[0]);
        expect(game?.title).toBe('Game 01');
    });

    it('returns null for a non-existent game', async () => {
        await seedGames(db, 2);
        expect(await getGameById(db, 99999)).toBeNull();
    });

    it('returns a publisher and its games', async () => {
        await seedGames(db, 2);
        const publisher = await getPublisherById(db, 1);

        expect(publisher).toEqual({ id: 1, name: 'Pub One', description: 'pub' });
        expect((await getGamesByPublisher(db, 1)).map((game) => game.title)).toEqual([
            'Game 01',
            'Game 02',
        ]);
    });

    it('returns null for a missing publisher', async () => {
        expect(await getPublisherById(db, 99999)).toBeNull();
    });
});
