import { MapBounds, MapPos } from '@nativescript-community/ui-carto/core';
import { VectorElement } from '@nativescript-community/ui-carto/vectorelements';
import { LineStyleBuilderOptions } from '@nativescript-community/ui-carto/vectorelements/line';
import { MarkerStyleBuilderOptions } from '@nativescript-community/ui-carto/vectorelements/marker';
import { Color } from '@nativescript/core/color';
import { Route, RouteRepository } from './Route';
import NSQLDatabase from '../mapModules/NSQLDatabase';

import CrudRepository from 'kiss-orm/dist/Repositories/CrudRepository';
import SqlQuery from 'kiss-orm/dist/Queries/SqlQuery';
const sql = SqlQuery.createFromTemplateString;

export interface Address {
    country?: string;
    name?: string;
    county?: string;
    state?: string;
    neighbourhood?: string;
    postcode?: string;
    region?: string;
    road?: string;
    houseNumber?: string;
}

namespace StyleTransformer {
    export function to(
        value: MarkerStyleBuilderOptions & LineStyleBuilderOptions
    ): MarkerStyleBuilderOptions & LineStyleBuilderOptions {
        const result = { ...value };
        Object.keys(result).forEach((k) => {
            if (result[k] instanceof Color) {
                result[k] = result[k].hex;
            }
        });
        return result as any;
    }

    export function from(
        value: MarkerStyleBuilderOptions & LineStyleBuilderOptions
    ): MarkerStyleBuilderOptions & LineStyleBuilderOptions {
        return value;
    }
}

export class Item {
    public readonly id!: string;

    public readonly properties!: {
        [k: string]: any;
        name?: string;
        osm_value?: string;
        osm_key?: string;
        class?: string;
        layer?: string;
    } | null;

    public provider!: 'photon' | 'here' | 'carto' | null;

    public categories!: string[] | null;

    public address!: Address | null;

    public zoomBounds!: MapBounds<LatLonKeys> | null;

    public position!: MapPos<LatLonKeys> | null;

    public styleOptions!: (MarkerStyleBuilderOptions & LineStyleBuilderOptions) | null;

    public routeId!: string;
    public route?: Route;
}
export type IItem = Partial<Item> & {
    vectorElement?: VectorElement<any, any>;
};

export class ItemRepository extends CrudRepository<Item> {
    constructor(database: NSQLDatabase) {
        super({
            database,
            table: 'Items',
            primaryKey: 'id',
            model: Item,
            relationships: {
                route: (item: Item) => new RouteRepository(database).getRoute(item.routeId)
            }
        });
    }

    async createTables() {
        return this.database.query(sql`
			CREATE TABLE IF NOT EXISTS "Items" (
				id TEXT PRIMARY KEY NOT NULL,
				properties TEXT,
				provider TEXT,
				styleOptions TEXT,
				address TEXT,
				zoomBounds TEXT,
				position TEXT NOT NULL,
				routeId TEXT
			);
		`);
    }

    async createItem(item: IItem) {
        const toSave = {};
        Object.keys(item).forEach((k) => {
            if (k === 'route') {
                return;
            }
            const data = item[k];
            if (typeof data === 'string') {
                toSave[k] = data;
            } else {
                if (k === 'styleOptions') {
                    Object.keys(data).forEach((k2) => {
                        if (data[k2] instanceof Color) {
                            data[k2] = data[k2].hex;
                        }
                    });
                }
                toSave[k] = JSON.stringify(data);
            }
        });
        await this.create(toSave);
        return item as Item;
    }
    async updateItem(item: Item, data: Partial<IItem>) {
        const toSave = {};
        Object.keys(data).forEach((k) => {
            if (typeof data[k] === 'string') {
                toSave[k] = data[k];
            } else {
                const d = data[k];
                if (k === 'styleOptions') {
                    Object.keys(d).forEach((k2) => {
                        if (d[k2] instanceof Color) {
                            d[k2] = d[k2].hex;
                        }
                    });
                }
                toSave[k] = JSON.stringify(d);
            }
        });
        return this.update(item, toSave);
    }

    prepareGetItem(item) {
        Object.keys(item).forEach((k) => {
            if (k !== 'id' && k !== 'routeId') {
                item[k] = JSON.parse(item[k]);
            }
        });
        return item;
    }
    async getItem(itemId: string) {
        let result = await this.get(itemId);
        result = this.prepareGetItem(result);
        result = await this.loadRelationship(result, 'route');
        return result;
    }
    async searchItem(where?: SqlQuery | null, orderBy?: SqlQuery | null) {
        const result = (await this.search(where, orderBy)).slice();
        for (let index = 0; index < result.length; index++) {
            let element = this.prepareGetItem(result[index]);
            if (element.routeId) {
                element = await this.loadRelationship(element, 'route');
            }
            result[index] = element;
        }
        return result;
    }
}

// @Entity()
// export default class Item extends BaseEntity {
//     @PrimaryGeneratedColumn()
//     id: number;

//     @Column('simple-json', { nullable: true })
//     properties?: {
//         [k: string]: any;
//         name?: string;
//         osm_value?: string;
//         osm_key?: string;
//         class?: string;
//         layer?: string;
//     };

//     @Column({ nullable: true })
//     provider?: 'photon' | 'here' | 'carto';

//     @Column('simple-array', { nullable: true })
//     categories?: string[];

//     @Column('simple-json', { nullable: true })
//     address?: Address;

//     @Column('simple-json', { nullable: true })
//     zoomBounds?: MapBounds<LatLonKeys>;

//     @Column('simple-json', { nullable: true })
//     position?: MapPos<LatLonKeys>;

//     @Column('simple-json', { nullable: true, transformer: StyleTransformer })
//     styleOptions?: MarkerStyleBuilderOptions & LineStyleBuilderOptions;

//     @OneToOne((type) => Route, { cascade: true, nullable: true, eager: true })
//     @JoinColumn()
//     route: Route;

//     vectorElement?: VectorElement<any, any>;
// }