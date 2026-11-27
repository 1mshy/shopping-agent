# WDC country packs

Download the Product statistics ZIP from the [WDC Schema.org Table Corpus 2023](https://webdatacommons.org/structureddata/schemaorgtables/2023/index.html#download). Run the builder offline with Python 3.

```sh
python3 lab/country-packs/build.py Product_statistics.zip CA ca.json.gz
```

The pack lists candidate storefront hosts in alphabetical order. The builder selects the country's ccTLD (including .uk for GB), at least ten Product rows, and an offers density of at least 50 percent. The top-100 and minimum-three subsets contain all tables eligible for the ten-row threshold. WDC statistics describe the 2023 crawl. Membership supplies neither a current price nor a trust verdict.

The [Canadian seed pack](./ca.json.gz) contains 22,028 unique hosts. It was generated with the command above from the published Product statistics ZIP (SHA-256 `419ae49b007a98b66fa99f2184cbe9fd0e07ad91a61fd85b149cacb7e7cc9551`). Download the gzip file using GitHub's raw-file download button.
