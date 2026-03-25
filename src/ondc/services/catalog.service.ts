import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '@prisma/client';
import {
  Provider,
  Item,
  ProviderFulfillment,
  ProviderLocation,
  Category,
  OnSearchCatalog,
} from '../interfaces/catalog.interface';
import { Descriptor } from '../interfaces/beckn-message.interface';
import {
  LOGISTICS_ITEMS,
  LogisticsCategoryId,
  VEHICLE_CATEGORIES,
  SERVICEABLE_CITIES,
  LogisticsItem,
} from '../constants/category-codes';
import { getErrorMessage } from '../types/ondc-error.interface';

/**
 * CatalogService manages ONDC catalog for logistics services
 * Generates on_search responses with available services
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);
  private readonly providerId: string;
  private readonly providerName: string;
  private readonly providerShortDesc: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.providerId = this.configService.get<string>('ondc.providerId') || 'P1';
    this.providerName =
      this.configService.get<string>('ondc.providerName') ||
      'QuikBoys Logistics';
    this.providerShortDesc =
      this.configService.get<string>('ondc.providerShortDesc') ||
      'Hyperlocal delivery services';
  }

  /**
   * Build catalog for on_search response
   */
  buildCatalog(city: string, fulfillmentType?: string): OnSearchCatalog {
    // Check if city is serviceable
    const cityInfo = SERVICEABLE_CITIES.find(
      (c) => c.code === city || c.name.toLowerCase() === city?.toLowerCase(),
    );

    if (!cityInfo) {
      this.logger.warn(`City not serviceable: ${city}`);
      return {
        'bpp/descriptor': this.buildBppDescriptor(),
        'bpp/providers': [],
      };
    }

    return {
      'bpp/descriptor': this.buildBppDescriptor(),
      'bpp/providers': [this.buildProvider(cityInfo, fulfillmentType)],
    };
  }

  /**
   * Build BPP descriptor with bpp_terms tags per ONDC spec
   */
  private buildBppDescriptor(): Descriptor {
    return {
      name: this.providerName,
      short_desc: this.providerShortDesc,
      images: [
        {
          url: 'https://quikboys.in/images/logo.png',
          size_type: 'sm',
        },
        {
          url: 'https://quikboys.in/images/logo-lg.png',
          size_type: 'lg',
        },
      ],
      tags: [
        {
          code: 'bpp_terms',
          list: [
            { code: 'static_terms', value: '' },
            {
              code: 'static_terms_new',
              value: 'https://quikboys.in/ondc/static-terms',
            },
            {
              code: 'effective_date',
              value: '2024-01-01T00:00:00.000Z',
            },
          ],
        },
      ],
    };
  }

  /**
   * Build provider object
   */
  private buildProvider(
    cityInfo: (typeof SERVICEABLE_CITIES)[0],
    fulfillmentType?: string,
  ): Provider {
    return {
      id: this.providerId,
      descriptor: {
        name: this.providerName,
        short_desc: this.providerShortDesc,
        images: [
          {
            url: 'https://quikboys.in/images/logo.png',
            size_type: 'sm',
          },
          {
            url: 'https://quikboys.in/images/logo-lg.png',
            size_type: 'lg',
          },
        ],
      },
      categories: this.buildCategories(),
      items: this.buildItems(fulfillmentType),
      fulfillments: this.buildFulfillments(fulfillmentType),
      locations: this.buildLocations(cityInfo),
      tags: [
        {
          code: 'serviceability',
          list: [
            { code: 'location', value: cityInfo.code },
            { code: 'category', value: 'Standard Delivery' },
            { code: 'type', value: 'hyperlocal' },
            { code: 'val', value: '30' }, // 30 km radius
            { code: 'unit', value: 'km' },
          ],
        },
        {
          code: 'lsp_features',
          list: [
            { code: 'hyperlocal', value: 'yes' },
            { code: 'multi_pickup', value: 'no' },
            { code: 'rescheduling', value: 'yes' },
            { code: 'cancellation', value: 'yes' },
          ],
        },
      ],
    };
  }

  /**
   * Build categories including Standard Delivery per ONDC Pramaan spec
   */
  private buildCategories(): Category[] {
    return [
      {
        id: LogisticsCategoryId.STANDARD_DELIVERY,
        descriptor: {
          name: 'Standard Delivery',
          short_desc: 'Standard delivery within 24-48 hours',
        },
      },
      {
        id: LogisticsCategoryId.IMMEDIATE_DELIVERY,
        descriptor: {
          name: 'Immediate Delivery',
          short_desc: 'On-demand delivery within 1-2 hours',
        },
      },
      {
        id: LogisticsCategoryId.EXPRESS_DELIVERY,
        descriptor: {
          name: 'Express Delivery',
          short_desc: 'Delivery within 4 hours',
        },
      },
      {
        id: LogisticsCategoryId.SAME_DAY_DELIVERY,
        descriptor: {
          name: 'Same Day Delivery',
          short_desc: 'Delivery within the same day',
        },
      },
    ];
  }

  /**
   * Build items (logistics services)
   */
  private buildItems(fulfillmentType?: string): Item[] {
    const items: Item[] = [];

    for (const [itemId, itemInfo] of Object.entries(LOGISTICS_ITEMS)) {
      // Filter by fulfillment type if specified
      // Note: 'Delivery' means delivery services (vs self-pickup), not a filter on item names
      // All our items are delivery services, so return all when fulfillmentType is 'Delivery'
      if (fulfillmentType && fulfillmentType.toLowerCase() !== 'delivery') {
        // Only filter by vehicle category (BIKE, AUTO, etc.) if that's what's specified
        if (!itemId.toLowerCase().includes(fulfillmentType.toLowerCase())) {
          continue;
        }
      }

      // Get vehicle pricing
      const vehicleCategory = itemInfo.vehicleCategory || 'BIKE';
      const pricing = VEHICLE_CATEGORIES[vehicleCategory];

      items.push({
        id: itemId,
        category_id: itemInfo.categoryId, // Required by ONDC Pramaan (singular form)
        category_ids: [itemInfo.categoryId],
        fulfillment_ids: [`F-${vehicleCategory}`],
        descriptor: {
          code: itemInfo.code,
          name: itemInfo.name,
          short_desc: itemInfo.shortDesc,
        },
        price: {
          currency: 'INR',
          value: pricing?.baseFare?.toString() || '30',
          minimum_value: pricing?.baseFare?.toString() || '30',
        },
        time: itemInfo.tat
          ? {
              label: 'TAT',
              duration: itemInfo.tat,
            }
          : undefined,
        tags: [
          {
            code: 'type',
            list: [{ code: 'type', value: 'delivery' }],
          },
        ],
      });
    }

    return items;
  }

  /**
   * Build fulfillments
   */
  private buildFulfillments(fulfillmentType?: string): ProviderFulfillment[] {
    const fulfillments: ProviderFulfillment[] = [];

    for (const [category, info] of Object.entries(VEHICLE_CATEGORIES)) {
      // 'Delivery' is a service type (vs self-pickup), not a vehicle category
      // All our fulfillments are delivery type, so return all when fulfillmentType is 'Delivery'
      if (
        fulfillmentType &&
        fulfillmentType.toLowerCase() !== 'delivery' &&
        category !== fulfillmentType.toUpperCase()
      ) {
        continue;
      }

      fulfillments.push({
        id: `F-${category}`,
        type: 'Delivery',
        tracking: true,
        tags: [
          {
            code: 'vehicle',
            list: [
              { code: 'category', value: category },
              { code: 'capacity', value: info.capacity },
            ],
          },
        ],
      });
    }

    return fulfillments;
  }

  /**
   * Build provider locations with complete address fields per ONDC spec
   */
  private buildLocations(
    cityInfo: (typeof SERVICEABLE_CITIES)[0],
  ): ProviderLocation[] {
    return [
      {
        id: `LOC-${cityInfo.code}`,
        gps: cityInfo.center,
        address: {
          name: `QuikBoys ${cityInfo.name} Hub`,
          building: 'QuikBoys Logistics Center',
          street: cityInfo.street || 'Main Road',
          locality: cityInfo.locality || `${cityInfo.name} Central`,
          city: cityInfo.name,
          state: cityInfo.state,
          country: 'India',
          area_code: cityInfo.areaCode,
        },
        time: {
          label: 'Operating Hours',
          range: {
            start: '08:00',
            end: '22:00',
          },
        },
      },
    ];
  }

  /**
   * Check if a city is serviceable
   */
  isServiceableCity(cityCode: string): boolean {
    return SERVICEABLE_CITIES.some((city) => city.code === cityCode);
  }

  /**
   * Get item by ID
   */
  getItem(itemId: string): LogisticsItem | undefined {
    return LOGISTICS_ITEMS[itemId];
  }

  /**
   * Get vehicle category by fulfillment ID
   */
  getVehicleCategoryByFulfillmentId(fulfillmentId: string): string | undefined {
    // Extract category from fulfillment ID (F-BIKE, F-AUTO, etc.)
    const parts = fulfillmentId.split('-');
    if (parts.length === 2) {
      return parts[1];
    }
    return undefined;
  }

  /**
   * Store catalog item in database
   */
  async storeCatalogItem(
    itemId: string,
    categoryId: string,
    descriptor: Descriptor,
    price: { currency: string; value: string },
    fulfillmentIds: string[],
    locationIds: string[],
  ): Promise<void> {
    try {
      await this.prisma.ondcCatalog.upsert({
        where: {
          providerId_itemId: {
            providerId: this.providerId,
            itemId,
          },
        },
        create: {
          providerId: this.providerId,
          itemId,
          categoryId,
          descriptor: descriptor as any,
          price: price as any,
          fulfillmentIds,
          locationIds,
          isActive: true,
        },
        update: {
          categoryId,
          descriptor: descriptor as any,
          price: price as any,
          fulfillmentIds,
          locationIds,
          isActive: true,
        },
      });

      this.logger.debug(`Stored catalog item: ${itemId}`);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to store catalog item: ${getErrorMessage(error)}`,
      );
    }
  }
}
