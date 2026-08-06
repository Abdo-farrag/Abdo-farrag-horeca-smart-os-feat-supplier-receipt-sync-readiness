# Horeca Smart OS — Procurement V1 Design Specification

- **الحالة:** جاهز للمراجعة
- **التاريخ:** 2026-07-24
- **النطاق:** Procurement Overview + Supplier Review + Product Procurement Settings + Audit Log
- **قاعدة البيانات:** مشروع Supabase الحالي `afzxhuaeggrngvchbvur`
- **مبدأ أساسي:** لا يتم إنشاء قاعدة بيانات بديلة، ولا يقرأ الـFrontend الجداول الداخلية مباشرة.

---

## 1. الرؤية والهدف

الهدف من Procurement V1 هو تحويل بيانات المبيعات والمخزون والتوقعات والموردين الموجودة حاليًا في Supabase إلى أداة تشغيل يومية موثوقة لفريق المشتريات.

الإصدار الأول لا ينشئ أوامر شراء ولا RFQ ولا موردين جدد. وظيفته الأساسية هي:

1. تحديد المنتجات التي تحتاج شراء.
2. إظهار سبب التوصية بصورة مفهومة.
3. اقتراح مورد اعتمادًا على آخر استلام مخزون فعلي.
4. تمكين Reviewer أو Admin من مراجعة المورد وتسجيل القرار.
5. تمكين Admin من تعديل Lead Time وSafety Stock Days.
6. الاحتفاظ بسجل رقابي كامل لكل تغيير.
7. إظهار جودة البيانات وحالة المزامنة بدل عرض أرقام قديمة دون تحذير.

اسم المنتج داخل المنصة:

> **Horeca Smart OS — Procurement**

---

## 2. حدود الإصدار الأول

### 2.1 داخل النطاق

- Procurement Overview.
- Supplier Review.
- Product Procurement Settings.
- Audit Log.
- Shared-password access لشاشة Overview.
- Supabase Auth لشاشات الموظفين.
- أدوار Reviewer وAdmin.
- Server-side filtering, sorting, pagination.
- تصدير Excel وCSV وفق الفلاتر الحالية.
- Monitoring لآخر مزامنة وحالة البيانات.
- API مستقرة بين التطبيق وقاعدة البيانات.
- اختبارات Unit وIntegration وEnd-to-End للوظائف الحساسة.

### 2.2 خارج النطاق

- إنشاء Purchase Orders داخل Odoo.
- إنشاء RFQ.
- إنشاء مورد جديد.
- Supplier Directory كامل.
- Workflow مالي أو حدود ائتمانية.
- تعديل Forecast يدويًا.
- تعديل المخزون من التطبيق.
- Inventory transfers.
- AI Agents.
- تطبيق موبايل.
- Modules المبيعات والعملاء والتوصيل والمالية.

يمكن إظهار الوحدات المستقبلية في القائمة الجانبية كعناصر غير مفعلة، لكن لا يتم بناء وظائفها في V1.

---

## 3. القرارات المعتمدة

### 3.1 الشركات

- العرض الافتراضي: كل الشركات مجمعة.
- الفلاتر: All Companies، MAS، Horeca Smart.
- المورد المعتمد موحد على مستوى المنتج ويطبق على الشركتين.
- تفاصيل الصف تعرض تقسيم الاحتياج بين MAS وHoreca Smart.

### 3.2 فترة التغطية

- 7 أيام.
- 14 يومًا — القيمة الافتراضية.
- 21 يومًا.
- 30 يومًا.

### 3.3 مصدر المخزون

- يستخدم النظام `free_qty` فقط كرصيد متاح للحساب.
- لا يقوم الـFrontend بحساب المخزون أو خصم الحجوزات.

### 3.4 المورد المقترح

المورد المقترح هو:

> آخر مورد تم استلام مخزون المنتج منه فعليًا.

لا يعتمد الاختيار الأساسي على:

- آخر أمر شراء فقط.
- آخر فاتورة فقط.
- أقل سعر.
- أكثر مورد تكرارًا.

عند تساوي وقت الاستلام بين أكثر من سجل، يكون الترتيب الحاسم:

1. أحدث `received_at`.
2. ثم أكبر كمية مستلمة.
3. ثم أصغر معرف مورد كترتيب ثابت فقط.

### 3.5 البيانات غير الكافية

- تظهر الحالة `Insufficient Data`.
- لا يتم إنشاء توصية شراء تلقائية.
- يظل المنتج ظاهرًا للمراجعة.
- تعديل Lead Time أوSafety Stock لا يزيل الحالة وحده؛ مصدر الحالة هو محرك التوقعات.

### 3.6 الصلاحيات

#### Reviewer

- مراجعة المورد.
- Approve.
- Reject.
- Change Supplier من الموردين التاريخيين.
- Needs Supplier.
- Bulk Approve فقط.
- مشاهدة سجلات مراجعة الموردين المرتبطة بصلاحياته.

#### Admin

كل صلاحيات Reviewer، بالإضافة إلى:

- Undo.
- تعديل Lead Time.
- تعديل Safety Stock Days.
- التعديل الجماعي المحدود لإعدادات المنتجات.
- إدارة المستخدمين والأدوار في مرحلة التنفيذ الخاصة بالإدارة.
- مشاهدة Audit Log الكامل.
- التصدير الكامل وفق الصلاحيات.

---

## 4. اتجاه التصميم وتجربة الاستخدام

تم اختيار واجهة هجينة:

1. مؤشرات مختصرة في أعلى الشاشة.
2. تنبيهات جودة البيانات.
3. شريط فلاتر واضح.
4. جدول تشغيلي هو العنصر الرئيسي.
5. تفاصيل المنتج في لوحة جانبية أو صف موسع.

الواجهة:

- عربية بالكامل.
- RTL.
- Desktop-first.
- Responsive للشاشات الأصغر، دون اعتبار الهاتف منصة تشغيل أساسية في V1.
- لا تعتمد على الألوان وحدها؛ كل حالة لها نص وأيقونة.
- الأرقام والكميات تظهر بتنسيق واضح، وتدعم الكسور فقط عندما تكون وحدة المنتج تسمح بذلك، بينما Suggested Qty النهائية تقرب لأعلى إلى أقرب وحدة شراء صحيحة يحددها محرك البيانات.

---

## 5. التنقل والمسارات

```text
/procurement
/procurement/suppliers-review
/procurement/product-settings
/procurement/audit-log
/login
/overview-access
```

القائمة الجانبية:

```text
Horeca Smart OS

المشتريات
├── نظرة عامة
├── مراجعة الموردين
├── إعدادات المنتجات
└── سجل العمليات

وحدات مستقبلية — غير مفعلة
├── المخزون
├── المبيعات
├── العملاء
├── التوصيل
└── الإدارة التنفيذية
```

---

## 6. شاشة Procurement Overview

### 6.1 الغرض

شاشة قراءة وتحليل لاتخاذ قرار الشراء، بدون تعديل مباشر للبيانات التشغيلية.

### 6.2 رأس الصفحة

- عنوان الصفحة.
- آخر مزامنة ناجحة.
- حالة البيانات: Updated، Delayed، Critical، Sync Error.
- زر Export.
- رابط دخول الموظفين أو اسم المستخدم الحالي.

### 6.3 الفلاتر

- Company.
- Coverage: 7/14/21/30.
- Priority.
- Supplier Status.
- Needs Purchase.
- Insufficient Data.
- No Supplier.
- Search by product code/name.
- Sort by priority, suggested quantity, coverage days, product name, latest receipt.

جميع الفلاتر والترتيب وPagination تتم على الخادم.

### 6.4 المؤشرات

- عدد المنتجات التي تحتاج شراء.
- عدد المنتجات Critical.
- إجمالي Suggested Qty.
- عدد المنتجات بدون مورد.
- عدد المنتجات Insufficient Data.
- آخر مزامنة ناجحة.

الضغط على المؤشر يطبق الفلتر المقابل.

### 6.5 تنبيهات جودة البيانات

تظهر تحذيرات واضحة عند:

- تأخر sales sync.
- تأخر stock sync.
- تأخر forecast calculation.
- وجود منتجات بدون مورد.
- وجود منتجات ببيانات غير كافية.
- وجود اختلاف بين وقت آخر مزامنة ووقت آخر حساب.

تصنيف حداثة البيانات في V1:

- **Updated:** آخر مزامنة ناجحة خلال 8 ساعات.
- **Delayed:** أكثر من 8 ساعات وحتى 24 ساعة.
- **Critical:** أكثر من 24 ساعة.
- **Sync Error:** آخر محاولة فشلت ولم تحدث مزامنة ناجحة بعدها.

هذه الحدود قابلة للتعديل لاحقًا من إعدادات النظام، لكنها ثابتة في V1.

### 6.6 جدول المنتجات

الأعمدة الأساسية:

- Product Code.
- Product Name.
- `free_qty`.
- Forecast Qty للفترة المختارة.
- Coverage Days.
- Lead Time Days.
- Safety Stock Days.
- Suggested Order Qty.
- Priority.
- Proposed Supplier.
- Supplier Review Status.

### 6.7 تفاصيل المنتج

تظهر في صف موسع:

- إجمالي الطلب المتوقع.
- احتياج MAS.
- احتياج Horeca Smart.
- Last Sale Date.
- Last Actual Receipt Date.
- Last Actual Receiving Supplier.
- Forecast Data Status.
- مكونات الحساب.
- سبب الأولوية.
- تحذيرات الجودة.

### 6.8 حالات الصف

#### Needs Purchase

Suggested Qty أكبر من صفر.

#### Stock Sufficient

Suggested Qty تساوي صفرًا، وتظهر عبارة `الرصيد كافٍ`.

#### Insufficient Data

لا تظهر توصية شراء رقمية، وتظهر `بيانات غير كافية`.

#### Needs Supplier

لا يوجد مورد تاريخي صالح، وتظهر `يحتاج تعيين مورد`.

### 6.9 التعديل من الشاشة

الشاشة Read-only. لا تسمح بـ:

- تعديل Suggested Qty.
- اعتماد أو تغيير المورد.
- تعديل Lead Time.
- تعديل Safety Stock.

---

## 7. شاشة Supplier Review

### 7.1 الغرض

اعتماد أو رفض أو تغيير المورد المقترح لكل منتج، مع سجل رقابي كامل.

### 7.2 الحالات

- `pending_review`
- `approved`
- `rejected`
- `needs_supplier`

### 7.3 الجدول

- Checkbox للاعتماد الجماعي فقط.
- Product Code.
- Product Name.
- Suggested Qty.
- Priority.
- Proposed Supplier.
- Last Receipt Date.
- Approved Supplier.
- Review Status.
- Actions.

### 7.4 لوحة المراجعة

تحتوي على:

- بيانات المنتج.
- `free_qty`.
- Forecast.
- Suggested Qty.
- Priority.
- احتياج كل شركة.
- المورد المقترح.
- سجل الموردين التاريخيين.

الموردون التاريخيون يرتبون حسب أحدث استلام فعلي. يعرض لكل مورد، عند توفر البيانات:

- Supplier Name.
- Last Receipt Date.
- Receipt Count.
- Last Received Qty.
- Last Purchase Price.
- Receiving Company.

### 7.5 الإجراءات

#### Approve

- يحفظ المورد المقترح أو المختار كمورد معتمد.
- يحول الحالة إلى `approved`.

#### Change Supplier

- يسمح باختيار مورد تاريخي آخر فقط في V1.
- بعد الحفظ تصبح الحالة `approved`.

#### Reject

- يحول الحالة إلى `rejected`.
- الملاحظة اختيارية.

#### Needs Supplier

- يحول الحالة إلى `needs_supplier`.
- يستخدم عندما لا يوجد مورد مناسب أو لا يوجد تاريخ توريد.

### 7.6 Bulk Approve

- متاح فقط للحالة `pending_review`.
- يتطلب وجود proposed supplier.
- الحد الأقصى لكل عملية: 200 منتج.
- لا يوجد Bulk Reject أوBulk Change.
- العملية Transactional على مستوى كل منتج، مع نتيجة نجاح أو فشل لكل عنصر.
- يسجل Batch ID واحد، بالإضافة إلى سجل تفصيلي لكل منتج.

### 7.7 Undo

- Admin فقط.
- لا يحذف العملية الأصلية.
- ينشئ عملية عكسية جديدة.
- يسمح به فقط إذا لم يحدث تغيير أحدث على نفس المنتج بعد العملية المراد التراجع عنها.

---

## 8. شاشة Product Procurement Settings

### 8.1 الغرض

ضبط مدخلات توصية الشراء الخاصة بكل منتج، دون تعديل المعادلة أو البيانات المصدر.

### 8.2 الصلاحيات

- Admin: تعديل.
- Reviewer: قراءة القيم داخل تفاصيل المنتج فقط.

### 8.3 القيم

- Lead Time Days.
- Safety Stock Days.

القيم الافتراضية:

- Lead Time = 4 أيام.
- Safety Stock = 7 أيام.

الحدود:

- Lead Time: من 0 إلى 90.
- Safety Stock: من 0 إلى 60.
- أعداد صحيحة فقط.

### 8.4 السلوك

عند الحفظ:

1. يتم التحقق من الصلاحية والقيمة.
2. يحفظ التغيير.
3. يسجل Audit Log في نفس المعاملة.
4. يعاد حساب المنتج من مصدر الحقيقة في Supabase.
5. يعاد للواجهة Before/After Snapshot.

### 8.5 التعديل الجماعي

- الحد الأقصى 200 منتج.
- يمكن تعديل Lead Time أوSafety Stock أوكليهما.
- يتطلب Confirmation.
- لا يوجد Excel Import في V1.

---

## 9. شاشة Audit Log

### 9.1 العمليات المسجلة

- Supplier Approve.
- Supplier Reject.
- Supplier Change.
- Needs Supplier.
- Undo.
- Lead Time Update.
- Safety Stock Update.
- Bulk Settings Update.
- User Role Change.
- User Enable/Disable.
- Login events ذات الأهمية الأمنية.
- Export requests.
- Recalculation failures.

لا تسجل عمليات القراءة العادية.

### 9.2 خصائص السجل

- Append-only من واجهة التطبيق.
- غير قابل للتعديل أو الحذف.
- يحتوي على actor، action، entity، before، after، timestamp، note، request_id، batch_id.
- أي تغيير تشغيلي يجب أن ينجح مع Audit Log في معاملة واحدة، أو يفشل الاثنان.

### 9.3 الفلاتر

- Date range.
- User.
- Action.
- Module.
- Product.
- Supplier.
- Batch actions.
- Undone actions.

### 9.4 التصدير

Admin فقط، بصيغ Excel وCSV، وفق الفلاتر الحالية.

---

## 10. معادلة التوصية والأولوية

مصدر الحقيقة للحساب هو Supabase، وليس المتصفح.

### 10.1 مكونات الحساب

```text
forecast_qty = forecast_daily_qty × coverage_days
lead_time_qty = forecast_daily_qty × lead_time_days
safety_stock_qty = forecast_daily_qty × safety_stock_days
suggested_order_qty = ceil(max(0,
  forecast_qty
  + lead_time_qty
  + safety_stock_qty
  - free_qty
))
```

إذا كانت وحدة شراء المنتج تفرض Pack Multiple، يتولى محرك Supabase التقريب إلى أقرب مضاعف صحيح. التطبيق يعرض الناتج النهائي والمكونات كما أعادها الـAPI.

### 10.2 Coverage Days

```text
coverage_days = free_qty / forecast_daily_qty
```

عندما يكون `forecast_daily_qty = 0`، تعاد القيمة كـ`null` مع حالة بيانات مناسبة، ولا ينفذ المتصفح قسمة محلية.

### 10.3 الأولوية

يحسب Supabase الأولوية بالقواعد التالية:

1. **Critical**
   - `free_qty <= 0` مع طلب متوقع أكبر من صفر، أو
   - `coverage_days < lead_time_days`.

2. **High**
   - `coverage_days < lead_time_days + safety_stock_days`.

3. **Medium**
   - Suggested Qty أكبر من صفر ولم يتحقق Critical أوHigh.

4. **Low**
   - لا يوجد احتياج شراء حالي.

في حالة `Insufficient Data` تكون الأولوية التشغيلية منفصلة عن Priority العادية، ولا يتم إنشاء Suggested Qty.

---

## 11. المعمارية التقنية

### 11.1 الخيار المعتمد

```text
Browser
  ↓
React Web App
  ↓
Replit Backend API
  ↓
Stable Supabase RPC / API Views
  ↓
Existing Supabase Tables and Forecast Engine
```

### 11.2 سبب الاختيار

- يمنع ربط الواجهة بـ29 جدولًا أوViews داخلية متغيرة.
- يجعل الـBackend عقدًا ثابتًا.
- يمنع كشف Service Role.
- يسمح بتطبيق الصلاحيات والتدقيق والتصدير على الخادم.
- يسهل نقل الاستضافة من Replit مستقبلًا.

### 11.3 هيكل المشروع المقترح

```text
apps/
├── web/                 # React + TypeScript + Vite
└── api/                 # Fastify + TypeScript

packages/
├── contracts/           # Zod schemas and shared API types
├── config/              # Shared configuration
└── ui/                  # Shared UI components when needed

supabase/
├── migrations/          # Reviewed SQL only
├── functions/           # RPC definitions or edge helpers if required
└── tests/               # SQL and contract tests

docs/
├── superpowers/specs/
├── architecture/
└── operations/
```

### 11.4 التشغيل على Replit

- Development: web وapi يعملان كخدمتين داخل Workspace واحد.
- Production: يبني Vite ملفات static، ويقدم Fastify الواجهة والـAPI من عملية Node واحدة.
- GitHub هو المصدر الرسمي للكود.
- Replit ليس المصدر الوحيد للكود ولا يحفظ أسرارًا داخل الملفات.

---

## 12. المصادقة والأمان

### 12.1 Overview Shared Password

- يخزن `OVERVIEW_PASSWORD_HASH` كـbcrypt hash في Replit Secrets.
- لا يخزن password خام.
- بعد التحقق يصدر الـBackend session cookie:
  - HttpOnly.
  - Secure في Production.
  - SameSite=Lax.
  - مدة 12 ساعة.
- Rate limiting:
  - 5 محاولات خلال 15 دقيقة لكل IP/session fingerprint.
  - تأخير تصاعدي بعد المحاولات الفاشلة.

### 12.2 Staff Authentication

- Supabase Auth Email/Password.
- يستخدم المتصفح Supabase anon key فقط لتسجيل الدخول.
- يرسل Access Token للـBackend في `Authorization: Bearer`.
- يتحقق الـBackend من الـJWT قبل كل endpoint محمي.

### 12.3 الأدوار

جدول صلاحيات مخصص في Supabase:

```text
app_user_roles
- user_id uuid primary key
- role text check in ('reviewer', 'admin')
- is_active boolean
- created_at timestamptz
- updated_at timestamptz
```

الـBackend يتحقق من الدور في كل طلب محمي.

### 12.4 الأسرار

يسمح في Replit Secrets فقط بـ:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OVERVIEW_PASSWORD_HASH`
- `SESSION_SECRET`

ممنوع:

- وضع Service Role في Browser bundle.
- Commit لأي `.env` يحتوي أسرارًا.
- طباعة الأسرار في logs.

### 12.5 الوصول المباشر للبيانات

- revoke وصول anon المباشر إلى API views الحساسة عند الحاجة.
- التعديلات التشغيلية تتم من خلال RPCs محمية أوBackend transactions.
- الـBackend هو Security Boundary الأساسية في V1.

---

## 13. طبقة Supabase API المستقرة

الأسماء التالية هي العقد المقترحة. يمكن تنفيذها كـRPCs أوViews مع Functions، لكن الـBackend لا يعتمد على الجداول الداخلية مباشرة.

### 13.1 قراءة Overview

```text
api_get_procurement_overview(filters, page, page_size, sort)
api_get_procurement_kpis(filters)
api_get_procurement_product(product_id, coverage_days, company_id)
api_get_sync_status()
```

### 13.2 Supplier Review

```text
api_get_supplier_review_queue(filters, page, page_size, sort)
api_get_product_supplier_history(product_id)
api_apply_supplier_review(product_id, action, supplier_id, note, expected_version)
api_bulk_approve_suppliers(items, note)
api_undo_supplier_action(audit_event_id, expected_version)
```

### 13.3 Product Settings

```text
api_get_product_procurement_settings(filters, page, page_size)
api_update_product_procurement_settings(product_id, lead_time_days, safety_stock_days, note, expected_version)
api_bulk_update_product_procurement_settings(items, note)
```

### 13.4 Audit

```text
api_get_audit_log(filters, page, page_size, sort)
api_get_audit_event(event_id)
```

### 13.5 Export

التصدير ينفذ من الـBackend ويستخدم نفس query service المستخدمة للجدول، لضمان تطابق البيانات والفلاتر.

---

## 14. عقد الـBackend API

كل endpoint يستخدم JSON باستثناء ملفات التصدير.

### 14.1 Endpoints عامة

```text
POST /api/overview/session
DELETE /api/overview/session
GET /api/health
GET /api/sync-status
```

### 14.2 Procurement

```text
GET /api/procurement/kpis
GET /api/procurement/products
GET /api/procurement/products/:productId
GET /api/procurement/export.csv
GET /api/procurement/export.xlsx
```

### 14.3 Supplier Review

```text
GET /api/supplier-reviews
GET /api/products/:productId/supplier-history
POST /api/supplier-reviews/:productId/actions
POST /api/supplier-reviews/bulk-approve
POST /api/audit-events/:eventId/undo
```

### 14.4 Settings

```text
GET /api/product-settings
PATCH /api/product-settings/:productId
PATCH /api/product-settings/bulk
```

### 14.5 Audit

```text
GET /api/audit-events
GET /api/audit-events/:eventId
GET /api/audit-events/export.csv
GET /api/audit-events/export.xlsx
```

### 14.6 Pagination

- Default page size: 50.
- Maximum page size: 200.
- Response includes:

```json
{
  "data": [],
  "page": 1,
  "page_size": 50,
  "total": 0,
  "total_pages": 0,
  "request_id": "uuid"
}
```

### 14.7 Error Envelope

```json
{
  "error": {
    "code": "SUPPLIER_REVIEW_CONFLICT",
    "message": "تم تعديل المنتج بواسطة مستخدم آخر. حدّث الصفحة وحاول مرة أخرى.",
    "details": null,
    "request_id": "uuid"
  }
}
```

رسائل الواجهة عربية، بينما أكواد الأخطاء ثابتة بالإنجليزية.

---

## 15. التحكم في التعارضات والمعاملات

### 15.1 Optimistic Concurrency

كل كيان قابل للتعديل يعيد:

- `version` أو `updated_at` موثوق.

يرسل العميل `expected_version` عند التعديل.

إذا تغير السجل بعد تحميله، يرفض الخادم العملية بـHTTP 409 بدل الكتابة فوق تعديل مستخدم آخر.

### 15.2 Transactions

يجب أن تتم العمليات التالية داخل معاملة واحدة:

- تحديث المورد +Audit Log.
- تحديث إعدادات المنتج +Audit Log +طلب إعادة الحساب.
- Undo +Audit Log.

إذا فشل Audit Log تفشل العملية كلها.

---

## 16. تدفق البيانات

### 16.1 تحميل Overview

1. المستخدم يفتح الشاشة.
2. الـFrontend يرسل الفلاتر.
3. الـBackend يتحقق من Shared Session أوStaff Token.
4. الـBackend يستدعي Supabase API layer.
5. Supabase يعيد النتائج المحسوبة والمكونات.
6. الـBackend يتحقق من Contract عبر Zod.
7. الواجهة تعرض البيانات والتنبيهات.

### 16.2 اعتماد مورد

1. Reviewer يفتح المنتج.
2. الواجهة تحمل Supplier History.
3. المستخدم يختار Approve أوChange أوReject أوNeeds Supplier.
4. يرسل الطلب مع `expected_version`.
5. RPC تنفذ التعديل وAudit في معاملة واحدة.
6. يعاد snapshot جديد.
7. الواجهة تحدث الصف وKPIs.

### 16.3 تعديل إعدادات المنتج

1. Admin يفتح إعدادات المنتج.
2. يدخل القيم.
3. الواجهة تتحقق مبدئيًا من الحدود.
4. الخادم يعيد التحقق.
5. RPC تحفظ القيم وتسجل Audit وتعيد الحساب.
6. الواجهة تعرض Before/After.

---

## 17. التصدير

- CSV وXLSX.
- يحترم الفلاتر والترتيب الحالي.
- ينفذ على الخادم.
- أسماء الأعمدة عربية في الملف النهائي، مع Sheet metadata يوضح:
  - وقت التصدير.
  - المستخدم.
  - الشركة.
  - فترة التغطية.
  - الفلاتر.
  - آخر مزامنة ناجحة.
- الحد الافتراضي للتصدير: 50,000 صف.
- إذا تجاوزت النتيجة الحد، يعاد خطأ واضح يطلب تضييق الفلاتر.
- كل عملية Export تسجل في Audit Log للموظفين.

---

## 18. معالجة الأخطاء

### 18.1 أخطاء المزامنة

- لا تمنع قراءة آخر بيانات ناجحة.
- يظهر Banner واضح بحالة التأخير.
- لا تعرض الواجهة البيانات كأنها حديثة.

### 18.2 أخطاء الشبكة

- تعرض رسالة قابلة لإعادة المحاولة.
- لا تعيد تنفيذ mutations تلقائيًا لتجنب التكرار.
- يمكن إعادة طلب عمليات القراءة تلقائيًا مرة واحدة فقط.

### 18.3 تعارضات التعديل

- HTTP 409.
- تعرض رسالة بأن مستخدمًا آخر عدل السجل.
- توفر زر تحديث البيانات.

### 18.4 فشل جزئي في Bulk

- يعاد نجاح/فشل لكل منتج.
- لا يعاد تنفيذ العناصر الناجحة تلقائيًا.
- يمكن تصدير قائمة العناصر الفاشلة من الواجهة لاحقًا، لكن هذا ليس شرطًا في V1.

### 18.5 أخطاء غير متوقعة

- Error ID / Request ID للمراجعة.
- رسالة آمنة للمستخدم.
- التفاصيل التقنية في server logs فقط دون أسرار.

---

## 19. المراقبة والسجلات

### 19.1 Health Endpoint

`GET /api/health` يعيد:

- application status.
- database connectivity.
- build version.
- server time.

لا يعيد أسرارًا أو معلومات جداول داخلية.

### 19.2 Structured Logging

كل log يحتوي على:

- timestamp.
- level.
- request_id.
- route.
- user_id عند وجوده.
- duration_ms.
- status_code.

لا يسجل:

- passwords.
- access tokens.
- service role keys.
- كامل request bodies للعمليات الحساسة.

---

## 20. الأداء

أهداف V1:

- أول تحميل Overview أقل من 3 ثوانٍ في الظروف الطبيعية.
- تغيير الفلاتر أقل من ثانيتين.
- فتح Supplier Review detail أقل من ثانيتين.
- Mutation فردية أقل من ثانيتين.
- Pagination إلزامية.
- لا تحميل كامل جدول المنتجات أوAudit Log داخل المتصفح.
- فهارس قاعدة البيانات تضاف فقط بعد فحص Query Plans، وليس بالتخمين.

---

## 21. الاختبارات

### 21.1 Unit Tests

- Validation للمدخلات.
- Role guards.
- Filter parsing.
- Error mapping.
- Priority display mapping.
- Session expiry.

### 21.2 Contract Tests

- كل RPC/API View يعيد Schema المتفق عليها.
- القيم nullable موثقة.
- حالات Insufficient Data.
- حالات No Supplier.

### 21.3 Integration Tests

- Approve supplier +Audit.
- Change supplier +Audit.
- Reject +Audit.
- Undo conflict.
- Update settings +recalculation +Audit.
- Bulk approve mixed results.
- Export respects filters.

### 21.4 End-to-End Tests

- Shared password →Overview →filter →export.
- Reviewer login →approve supplier.
- Reviewer ممنوع من Product Settings.
- Admin يعدل Lead Time ويرى Before/After.
- Admin ينفذ Undo صالح.
- Conflict يعرض رسالة صحيحة.
- Stale sync banner يظهر وفق الوقت.

### 21.5 Security Tests

- Service Role غير موجود في Browser build.
- Protected routes ترفض المستخدم غير المصادق.
- Reviewer لا يصل لـAdmin endpoints.
- Rate limit للـshared password.
- CSV injection protection في التصدير.

---

## 22. معايير القبول

يعتبر Procurement V1 جاهزًا عندما:

1. يمكن فتح Overview بكلمة المرور المشتركة.
2. تعرض KPIs والجدول من Supabase عبر الـBackend فقط.
3. تعمل فلاتر الشركة والتغطية والأولوية والحالة والبحث على الخادم.
4. يظهر Split بين MAS وHoreca Smart داخل التفاصيل.
5. يظهر سبب Suggested Qty ومكونات الحساب.
6. تظهر حالة Insufficient Data بدون توصية شراء.
7. يظهر آخر مورد استلام فعلي كمورد مقترح.
8. يستطيع Reviewer تنفيذ Approve/Reject/Change/Needs Supplier.
9. يعمل Bulk Approve فقط وبحد 200 منتج.
10. يستطيع Admin تعديل Lead Time وSafety Stock.
11. كل mutation لها Audit Log في نفس المعاملة.
12. يعمل Undo وفق قاعدة عدم وجود تغيير أحدث.
13. تعمل صادرات CSV وXLSX وفق الفلاتر.
14. تظهر حالة المزامنة وتحذيرات التأخير.
15. لا يوجد Service Role أوsecret داخل الـFrontend.
16. تمر اختبارات Unit وIntegration وE2E الأساسية.
17. يمكن تشغيل المشروع من GitHub على Replit باستخدام Secrets فقط.

---

## 23. استراتيجية GitHub والتنفيذ

- `main` يمثل النسخة المعتمدة فقط.
- كل مرحلة تنفذ في Branch مستقل.
- كل Pull Request يحتوي على:
  - الهدف.
  - الملفات المتغيرة.
  - اختبارات منفذة.
  - مخاطر أوMigrations.
  - Screenshots للواجهات عند بدء التنفيذ البصري.
- يمنع Commit الأسرار.
- Migrations لا تطبق على Production قبل مراجعتها.
- لا يتم حذف أوإعادة تسمية جداول حالية في Procurement V1 دون Migration منفصلة وخطة رجوع.

مراحل التنفيذ المقترحة بعد اعتماد هذا المستند:

1. Repository foundation and tooling.
2. Shared contracts and backend skeleton.
3. Supabase stable API layer.
4. Authentication and authorization.
5. Procurement Overview.
6. Supplier Review.
7. Product Settings.
8. Audit Log and exports.
9. Monitoring, tests, hardening.
10. Replit deployment and production verification.

---

## 24. القرارات المؤجلة عمدًا

هذه العناصر لا تمنع V1 ولا يجب تنفيذها الآن:

- إنشاء الموردين من داخل النظام.
- Multiple suppliers per company.
- Price-based supplier recommendation.
- إنشاء PO/RFQ.
- Approval workflow متعدد المستويات.
- AI-generated purchasing decisions.
- إعداد Thresholds من الواجهة.
- Excel import لإعدادات المنتجات.
- Mobile-first experience.

---

## 25. خلاصة التصميم

Procurement V1 هو أول Module داخل Horeca Smart OS، لكنه يظل مشروعًا محدود النطاق وقابلًا للاختبار. المعمارية تفصل الواجهة عن الجداول الداخلية، وتضع Supabase كمصدر حقيقة، وتستخدم Replit للتشغيل، وGitHub للمصدر الرسمي والمراجعة، مع Audit كامل لكل تعديل تشغيلي.

لا يبدأ تنفيذ الكود أوMigrations قبل اعتماد هذا المستند ثم كتابة Implementation Plan مفصلة ومراجعتها.
