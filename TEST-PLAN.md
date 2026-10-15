# Test Plan — Auto Collection AMCOLL

| No | Input | Expected |
|---|---|---|
| 1 | Semua identitas valid, nominal 150000 | Append A:AD, AD=150000, konfirmasi baris aktual |
| 2 | customer_name salah | INVALID_IDENTITY, tidak append |
| 3 | customer_number salah | INVALID_IDENTITY, tidak append |
| 4 | loan_id salah | INVALID_IDENTITY, tidak append |
| 5 | Identity sama + nominal sama | DUPLICATE, tidak append |
| 6 | Identity sama + nominal berbeda | Append baris baru |
| 7 | Dua laporan valid berurutan | Row n lalu n+1 |
| 8 | Request sama diulang karena retry | Ditolak sebagai duplicate jika data/ID tersimpan |
| 9 | Endpoint unavailable | Tidak ada klaim berhasil |
| 10 | Source triple match lebih dari satu baris | AMBIGUOUS, tidak append |
