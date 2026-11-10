'use client';
import { useApp } from '@/components/providers/AppProvider';
import { localized } from '@/lib/i18n';
import type { SharedQuoteLine } from '@/types/frontend';
const labels = [localized('محصول','Product','Ürün','المنتج','Продукт'),localized('واحد','Unit','Birim','الوحدة','Единица'),localized('تعداد','Quantity','Miktar','الكمية','Количество'),localized('قیمت واحد','Unit price','Birim fiyat','سعر الوحدة','Цена за единицу'),localized('تخفیف ٪','Discount %','İndirim %','الخصم ٪','Скидка %'),localized('خالص','Net','Net','الصافي','Итого')];
export default function QuoteLines({ lines }: {lines:SharedQuoteLine[]}) {
  const {locale} = useApp();
  if (!lines.length) return null;
  return <div className="quote-lines-scroll"><table className="data-table"><thead><tr>{labels.map((label,index) => <th key={index} scope="col">{label[locale]}</th>)}</tr></thead><tbody>{lines.map((line,index) => <tr key={`${line.id}-${index}`}><td>{line.titleSnapshot}<small className="quote-line-code"><bdi>{line.productId}</bdi></small></td><td><bdi>{line.unit}</bdi></td><td><bdi>{line.quantityDecimal}</bdi></td><td><bdi>{line.unitPriceDecimal ?? '—'} {line.currency}</bdi></td><td><bdi>{line.discountPercentDecimal}</bdi></td><td><bdi>{line.netDecimal ?? '—'} {line.currency}</bdi></td></tr>)}</tbody></table></div>;
}
