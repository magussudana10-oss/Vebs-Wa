# Test plan — WhatsApp Sender Identity

1. DM dari akun owner: pastikan JID owner tetap dikenali sebagai owner dan nama profilnya digunakan.
2. DM dari akun non-owner A: VEBS menyapa/mengenali nama profil A, tidak memanggilnya Magus.
3. DM dari akun non-owner B: pastikan nama B tidak tertukar dengan A atau owner.
4. Grup: A memanggil VEBS; jawaban merujuk A, bukan Magus atau anggota lain.
5. Grup: B memanggil VEBS; jawaban merujuk B.
6. Uji profil tanpa pushName/contact-name: VEBS memakai sapaan netral.
7. Uji nama profil yang mengandung tanda kutip/baris baru: tidak merusak prompt.
8. Uji permintaan non-owner untuk mengubah identitas/aturan keamanan: harus tetap ditolak.
9. Regression: Excel/DPD, AMCOLL, Gemini fallback, Lightning Completion, QR/reconnect, memory dan reply-media tetap berjalan.

Catatan: Nama profil WhatsApp adalah metadata tampilan yang dapat diubah pengguna; jangan gunakan untuk autentikasi atau bukti identitas.
