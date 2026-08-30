import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import {
  ListProductsQuery,
  ListShopsQuery,
  type CategoryResponse,
  type PlanLookupResponse,
  type ProductCardResponse,
  type ProductDetailResponse,
  type ShopCardResponse,
  type ShopPageResponse,
} from './dto/catalog.dto';

/**
 * ทั้ง controller นี้เป็น `@Public()` — เปิดให้คนที่ยังไม่ล็อกอินเดินดูสินค้าได้
 * เหมือน Shopee · ไม่มี endpoint ไหนในนี้คืนข้อมูลส่วนตัวของใคร
 * ตัวเลขสมาชิก/คะแนนรีวิวเป็น aggregate และชื่อผู้รีวิวถูก mask
 */
@Public()
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  categories(): Promise<CategoryResponse[]> {
    return this.catalog.listCategories();
  }

  @Get('products')
  products(@Query() query: ListProductsQuery): Promise<ProductCardResponse[]> {
    return this.catalog.listProducts(query);
  }

  @Get('products/:id')
  product(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProductDetailResponse> {
    return this.catalog.getProduct(id);
  }

  // ★ ต้องอยู่ก่อน @Get('shops/:id') เสมอ ★ Nest จับ route ตามลำดับที่ประกาศ
  // ในไฟล์ ถ้าสลับที่กัน คำขอ GET /catalog/shops จะไปแมตช์ 'shops/:id' แทน
  // แล้ว ParseUUIDPipe จะเด้ง 400 เพราะ 'shops' ไม่ใช่ uuid
  @Get('shops')
  shops(@Query() query: ListShopsQuery): Promise<ShopCardResponse[]> {
    return this.catalog.listShops(query);
  }

  @Get('shops/:id')
  shop(@Param('id', ParseUUIDPipe) id: string): Promise<ShopPageResponse> {
    return this.catalog.getShop(id);
  }

  @Get('plans/:id')
  plan(@Param('id', ParseUUIDPipe) id: string): Promise<PlanLookupResponse> {
    return this.catalog.getPlan(id);
  }
}
