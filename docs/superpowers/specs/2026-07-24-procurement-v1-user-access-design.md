# Procurement V1 — User Access and Administration Addendum

- **الحالة:** جاهز للمراجعة
- **التاريخ:** 2026-07-24
- **يعتمد على:** `2026-07-24-procurement-v1-design.md`

## 1. سبب الفصل

إدارة دخول الموظفين وظيفة مساندة لـProcurement V1 وليست Module أعمال مستقلة. تم فصل تفاصيلها في هذا المستند حتى يظل تصميم المشتريات الرئيسي مركزًا، مع بقاء كل قرارات الأمان والصلاحيات واضحة وقابلة للاختبار.

## 2. المسارات

```text
/login
/admin/users
```

- `/login`: دخول Reviewer وAdmin عبر Supabase Auth Email/Password.
- `/admin/users`: متاح للـAdmin فقط.

## 3. شاشة إدارة المستخدمين

تعرض:

- الاسم المعروض.
- البريد الإلكتروني.
- الدور: Reviewer أوAdmin.
- الحالة: Active أوDisabled.
- تاريخ إنشاء الحساب.
- آخر تسجيل دخول متاح من Supabase.
- آخر تعديل للدور ومن قام به.

الفلاتر:

- الدور.
- الحالة.
- البحث بالبريد أوالاسم.

## 4. الإجراءات

### 4.1 دعوة مستخدم

الـAdmin يدخل:

- البريد الإلكتروني.
- الاسم المعروض.
- الدور.

يستخدم الـBackend Supabase Admin API لإرسال Invitation. لا يحدد الـAdmin كلمة مرور المستخدم ولا يمكنه رؤيتها.

إذا لم يكن SMTP/Email delivery مهيأ في Supabase، يفشل الإجراء برسالة واضحة ولا ينشئ حسابًا ناقصًا. إعداد SMTP شرط نشر وليس جزءًا من كود التطبيق.

### 4.2 تغيير الدور

- Reviewer ↔ Admin.
- يتطلب Confirmation.
- يسجل في Audit Log.
- لا يسمح للـAdmin بخفض صلاحية آخر Admin نشط في النظام.

### 4.3 تعطيل أوتفعيل المستخدم

- التعطيل يمنع الوصول إلى endpoints المحمية فور التحقق التالي.
- لا يحذف حساب Supabase Auth.
- يسجل الإجراء في Audit Log.
- لا يسمح للمستخدم بتعطيل نفسه إذا كان آخر Admin نشط.

### 4.4 إعادة تعيين كلمة المرور

- التطبيق يرسل Supabase Password Reset Email.
- لا يخزن أوينشئ كلمة مرور مؤقتة داخل النظام.

## 5. مصدر الصلاحية

جدول `app_user_roles` هو مصدر صلاحية التطبيق:

```text
user_id uuid primary key references auth.users(id)
display_name text not null
role text not null check (role in ('reviewer', 'admin'))
is_active boolean not null default true
created_at timestamptz not null
updated_at timestamptz not null
updated_by uuid null
```

وجود المستخدم داخل `auth.users` وحده لا يمنحه صلاحية. يجب أن يكون له سجل Active في `app_user_roles`.

## 6. الجلسات

- Supabase Auth يدير Access وRefresh Tokens.
- الـFrontend يحتفظ بالجلسة بالطريقة القياسية الآمنة لمكتبة Supabase.
- الـBackend يتحقق من JWT ثم يتحقق من `app_user_roles` في كل mutation، ومع endpoints الحساسة.
- تعطيل المستخدم يمنع الطلب حتى لو كان لديه token لم تنته صلاحيته بعد، لأن فحص `is_active` يتم على الخادم.

## 7. Audit Log

يسجل التطبيق:

- إرسال دعوة.
- تغيير دور.
- تفعيل أوتعطيل.
- طلب إعادة تعيين كلمة المرور.
- نجاح جلسة دخول داخل التطبيق عندما يمكن ربطها بمستخدم.
- محاولات Shared Overview Password الفاشلة والناجحة.

محاولات Supabase Email/Password الفاشلة غير الموثوقة من المتصفح لا تستخدم كسجل رقابي رئيسي؛ المرجع لها هو Supabase Auth Logs. لا يرسل التطبيق كلمة المرور أوtoken إلى Audit Log.

## 8. API المقترحة

```text
GET  /api/admin/users
POST /api/admin/users/invite
PATCH /api/admin/users/:userId/role
PATCH /api/admin/users/:userId/status
POST /api/admin/users/:userId/password-reset
```

كل endpoint:

- Admin only.
- Zod validated.
- Rate limited للإجراءات التي ترسل بريدًا.
- يسجل Audit Event عند النجاح.
- يستخدم Optimistic Concurrency عند تعديل role أوstatus.

## 9. معايير القبول

1. لا يستطيع Reviewer فتح `/admin/users` أو استخدام endpoints الخاصة بها.
2. يمكن للـAdmin دعوة مستخدم وتحديد دوره.
3. لا يحصل أي مستخدم على صلاحية بدون سجل Active في `app_user_roles`.
4. يمكن تغيير الدور وتعطيل المستخدم مع Audit كامل.
5. لا يمكن تعطيل أوخفض صلاحية آخر Admin نشط.
6. لا تظهر كلمات المرور أوtokens في الواجهة أوlogs أوAudit.
7. يعمل Password Reset من خلال Supabase فقط.
