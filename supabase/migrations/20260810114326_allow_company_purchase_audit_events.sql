alter table public.procurement_audit_events
	drop constraint procurement_audit_events_event_type_check;

alter table public.procurement_audit_events
	add constraint procurement_audit_events_event_type_check
	check (event_type in (
		'SUPPLIER_APPROVED',
		'SUPPLIER_REJECTED',
		'SUPPLIER_CHANGED',
		'NEEDS_SUPPLIER',
		'UNDO',
		'PRODUCT_RULE_UPDATED',
		'PRODUCT_RULES_BULK_UPDATED',
		'USER_INVITED',
		'USER_ROLE_CHANGED',
		'USER_STATUS_CHANGED',
		'PASSWORD_RESET_REQUESTED',
		'OVERVIEW_LOGIN_SUCCEEDED',
		'OVERVIEW_LOGIN_FAILED',
		'EXPORT_CREATED',
		'RECALCULATION_FAILED',
		'COMPANY_PURCHASE_NEW',
		'COMPANY_PURCHASE_UNDER_REVIEW',
		'COMPANY_PURCHASE_APPROVED',
		'COMPANY_PURCHASE_REJECTED',
		'COMPANY_PURCHASE_DEFERRED'
	));

alter table public.procurement_audit_events
	drop constraint procurement_audit_events_module_check;

alter table public.procurement_audit_events
	add constraint procurement_audit_events_module_check
	check (module in (
		'SUPPLIER_REVIEW',
		'PRODUCT_SETTINGS',
		'USERS',
		'AUTH',
		'EXPORT',
		'SYSTEM',
		'RECOMMENDATION_REVIEW'
	));
