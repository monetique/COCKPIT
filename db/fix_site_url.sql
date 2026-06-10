-- ============================================================
--  Fix site_url — Nettoyer les valeurs contenant un email (@)
--  psql -U postgres -d clictopay_db -f fix_site_url.sql
-- ============================================================

-- 1. Voir les enregistrements concernés avant correction
SELECT processing_id, raison_sociale, site_url, email_contact
FROM merchants_tracking
WHERE site_url LIKE '%@%'
ORDER BY processing_id;

-- 2. Mettre site_url à NULL si la valeur contient un '@' (c'est un email, pas une URL)
UPDATE merchants_tracking
SET    site_url   = NULL,
       updated_at = NOW()
WHERE  site_url LIKE '%@%';

-- 3. Vérifier le résultat
SELECT COUNT(*) AS restant_avec_at FROM merchants_tracking WHERE site_url LIKE '%@%';
SELECT COUNT(*) AS avec_site_url FROM merchants_tracking WHERE site_url IS NOT NULL AND site_url <> '';
